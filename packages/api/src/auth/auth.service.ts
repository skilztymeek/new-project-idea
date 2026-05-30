/**
 * Auth Service — business logic for registration, login, logout, and session.
 *
 * Responsibilities:
 *  - Email and password validation
 *  - Password hashing with bcrypt
 *  - JWT issuance (RS256, 30-day expiry) and verification
 *  - Session revocation via Redis (jti-based blocklist)
 *  - Database queries for user creation and lookup
 */

import bcrypt from 'bcrypt';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * RFC 5322 simplified email regex.
 * Accepts the vast majority of real-world email addresses.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns true if the email string conforms to a valid email format.
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Returns true if the password meets the minimum length requirement (≥ 8 chars).
 */
export function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

export interface JwtKeys {
  privateKey: string;
  publicKey: string;
}

export interface TokenPayload {
  userId: string;
  tier: 'free' | 'premium';
  jti: string;
  exp: number;
  iat: number;
}

/**
 * Issues a signed RS256 JWT for the given user.
 */
export function issueToken(
  userId: string,
  tier: 'free' | 'premium',
  keys: JwtKeys,
): string {
  const jti = uuidv4();

  return jwt.sign({ userId, tier }, keys.privateKey, {
    algorithm: 'RS256',
    jwtid: jti,
    expiresIn: JWT_EXPIRY_SECONDS,
  });
}

/**
 * Verifies a JWT and returns the decoded payload.
 * Throws if the token is invalid or expired.
 */
export function verifyToken(token: string, publicKey: string): TokenPayload {
  const decoded = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
  }) as JwtPayload;

  return {
    userId: decoded['userId'] as string,
    tier: decoded['tier'] as 'free' | 'premium',
    jti: decoded['jti'] as string,
    exp: decoded['exp'] as number,
    iat: decoded['iat'] as number,
  };
}

// ---------------------------------------------------------------------------
// Session revocation (Redis)
// ---------------------------------------------------------------------------

/**
 * Adds a JWT's jti to the Redis revocation list.
 * The key expires automatically when the token would have expired.
 */
export async function revokeToken(
  redis: Redis,
  jti: string,
  exp: number,
): Promise<void> {
  const ttl = exp - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    await redis.set(`revoked:${jti}`, '1', 'EX', ttl);
  }
}

/**
 * Returns true if the given jti has been revoked.
 */
export async function isTokenRevoked(
  redis: Redis,
  jti: string,
): Promise<boolean> {
  const value = await redis.get(`revoked:${jti}`);
  return value !== null;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

export interface DbUser {
  id: string;
  email: string;
  password_hash: string | null;
  tier: 'free' | 'premium';
  created_at: string;
}

/**
 * Inserts a new user record and returns the created user.
 * Throws a DuplicateEmailError if the email is already registered.
 */
export async function createUser(
  pool: Pool,
  email: string,
  passwordHash: string,
): Promise<DbUser> {
  try {
    const result = await pool.query<DbUser>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, password_hash, tier, created_at`,
      [email.toLowerCase(), passwordHash],
    );
    return result.rows[0]!;
  } catch (err: unknown) {
    // PostgreSQL unique violation code
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new DuplicateEmailError();
    }
    throw err;
  }
}

/**
 * Looks up a user by email address.
 * Returns null if no user is found.
 */
export async function findUserByEmail(
  pool: Pool,
  email: string,
): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT id, email, password_hash, tier, created_at
     FROM users
     WHERE email = $1`,
    [email.toLowerCase()],
  );
  return result.rows[0] ?? null;
}

/**
 * Looks up a user by ID.
 * Returns null if no user is found.
 */
export async function findUserById(
  pool: Pool,
  id: string,
): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT id, email, password_hash, tier, created_at
     FROM users
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// High-level auth operations
// ---------------------------------------------------------------------------

export interface RegisterResult {
  token: string;
  userId: string;
  tier: 'free' | 'premium';
}

/**
 * Registers a new user with email and password.
 * Validates inputs, hashes the password, inserts the user, and issues a JWT.
 */
export async function register(
  pool: Pool,
  keys: JwtKeys,
  email: string,
  password: string,
): Promise<RegisterResult> {
  if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email address format.');
  }
  if (!isValidPassword(password)) {
    throw new ValidationError('Password must be at least 8 characters long.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await createUser(pool, email, passwordHash);
  const token = issueToken(user.id, user.tier, keys);

  return { token, userId: user.id, tier: user.tier };
}

export interface LoginResult {
  token: string;
  userId: string;
  tier: 'free' | 'premium';
}

/**
 * Authenticates a user with email and password.
 * Returns a JWT on success; throws InvalidCredentialsError on failure.
 */
export async function login(
  pool: Pool,
  keys: JwtKeys,
  email: string,
  password: string,
): Promise<LoginResult> {
  const user = await findUserByEmail(pool, email);

  // Use a constant-time comparison even when user is not found to prevent
  // timing-based email enumeration attacks.
  const hashToCompare =
    user?.password_hash ??
    '$2b$12$invalidhashpaddingtomakethisaconstanttimeoperation00000';

  const passwordMatches = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  const token = issueToken(user.id, user.tier, keys);
  return { token, userId: user.id, tier: user.tier };
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this email already exists.');
    this.name = 'DuplicateEmailError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials.');
    this.name = 'InvalidCredentialsError';
  }
}

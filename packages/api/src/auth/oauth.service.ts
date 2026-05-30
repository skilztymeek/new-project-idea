/**
 * OAuth Service — business logic for Google and Apple ID token verification
 * and user upsert.
 *
 * Responsibilities:
 *  - Verify Google ID tokens using google-auth-library
 *  - Verify Apple ID tokens using JWKS (jwks-rsa) + jsonwebtoken
 *  - Upsert user record in PostgreSQL (insert or update oauth fields)
 *  - Issue JWT on successful verification
 *  - Detect email conflicts with a different provider
 */

import { OAuth2Client } from 'google-auth-library';
import jwksClient from 'jwks-rsa';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import { Pool } from 'pg';
import { issueToken, JwtKeys } from './auth.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = ['google', 'apple'] as const;
export type OAuthProvider = (typeof SUPPORTED_PROVIDERS)[number];

const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported OAuth provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
  }
}

export class InvalidOAuthTokenError extends Error {
  constructor(message = 'Invalid or expired OAuth token.') {
    super(message);
    this.name = 'InvalidOAuthTokenError';
  }
}

export class OAuthEmailConflictError extends Error {
  constructor() {
    super('This email is already registered with a different sign-in method.');
    this.name = 'OAuthEmailConflictError';
  }
}

// ---------------------------------------------------------------------------
// Provider validation
// ---------------------------------------------------------------------------

/**
 * Returns true if the given string is a supported OAuth provider.
 */
export function isSupportedProvider(provider: string): provider is OAuthProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

export interface OAuthProfile {
  email: string;
  subject: string;
  provider: OAuthProvider;
}

/**
 * Verifies a Google ID token and extracts the user profile.
 * Throws InvalidOAuthTokenError if the token is invalid or expired.
 *
 * @param idToken - The ID token obtained from the Google OAuth flow
 * @param googleClientId - Optional Google client ID for audience validation;
 *                         if omitted, audience validation is skipped (useful in tests)
 */
export async function verifyGoogleToken(
  idToken: string,
  googleClientId?: string,
): Promise<OAuthProfile> {
  const client = new OAuth2Client(googleClientId);

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      ...(googleClientId ? { audience: googleClientId } : {}),
    });

    const payload = (ticket as unknown as { getPayload(): { email?: string; sub?: string } | null }).getPayload();
    if (!payload) {
      throw new InvalidOAuthTokenError('Google token payload is empty.');
    }

    const email = payload['email'];
    const subject = payload['sub'];

    if (!email || !subject) {
      throw new InvalidOAuthTokenError(
        'Google token is missing required fields (email, sub).',
      );
    }

    return { email, subject, provider: 'google' };
  } catch (err) {
    if (err instanceof InvalidOAuthTokenError) {
      throw err;
    }
    throw new InvalidOAuthTokenError(
      `Google token verification failed: ${(err as Error).message}`,
    );
  }
}

// Lazily-created Apple JWKS client (singleton per process)
let appleJwksClient: ReturnType<typeof jwksClient> | null = null;

function getAppleJwksClient(): ReturnType<typeof jwksClient> {
  if (!appleJwksClient) {
    appleJwksClient = jwksClient({
      jwksUri: APPLE_JWKS_URI,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    });
  }
  return appleJwksClient;
}

/**
 * Resolves the signing key for an Apple JWT from Apple's JWKS endpoint.
 * Used as the `secretOrRequestKey` callback for jsonwebtoken.
 */
function getAppleSigningKey(
  header: JwtHeader,
  callback: SigningKeyCallback,
): void {
  const client = getAppleJwksClient();
  client.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error('Apple signing key not found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

/**
 * Verifies an Apple ID token and extracts the user profile.
 * Throws InvalidOAuthTokenError if the token is invalid or expired.
 *
 * @param idToken - The ID token obtained from the Apple Sign-In flow
 * @param appleClientId - Optional Apple client ID (bundle ID) for audience validation
 */
export async function verifyAppleToken(
  idToken: string,
  appleClientId?: string,
): Promise<OAuthProfile> {
  return new Promise((resolve, reject) => {
    const verifyOptions: jwt.VerifyOptions = {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
    };

    if (appleClientId) {
      verifyOptions.audience = appleClientId;
    }

    jwt.verify(idToken, getAppleSigningKey, verifyOptions, (err, decoded) => {
      if (err || !decoded || typeof decoded === 'string') {
        reject(
          new InvalidOAuthTokenError(
            `Apple token verification failed: ${err?.message ?? 'unknown error'}`,
          ),
        );
        return;
      }

      const payload = decoded as jwt.JwtPayload;
      const email = payload['email'] as string | undefined;
      const subject = payload['sub'] as string | undefined;

      if (!email || !subject) {
        reject(
          new InvalidOAuthTokenError(
            'Apple token is missing required fields (email, sub).',
          ),
        );
        return;
      }

      resolve({ email, subject, provider: 'apple' });
    });
  });
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

export interface DbOAuthUser {
  id: string;
  email: string;
  oauth_provider: string;
  oauth_subject: string;
  tier: 'free' | 'premium';
  created_at: string;
}

/**
 * Upserts a user record for an OAuth login.
 *
 * Strategy:
 *  1. Try to find an existing user by (oauth_provider, oauth_subject).
 *     If found, return that user.
 *  2. Try to find an existing user by email.
 *     If found with a DIFFERENT provider, throw OAuthEmailConflictError.
 *     If found with the SAME provider (edge case), update and return.
 *  3. If no user exists, insert a new one.
 */
export async function upsertOAuthUser(
  pool: Pool,
  profile: OAuthProfile,
): Promise<DbOAuthUser> {
  const { email, subject, provider } = profile;

  // Step 1: Look up by (oauth_provider, oauth_subject) — the canonical OAuth identity
  const bySubjectResult = await pool.query<DbOAuthUser>(
    `SELECT id, email, oauth_provider, oauth_subject, tier, created_at
     FROM users
     WHERE oauth_provider = $1 AND oauth_subject = $2`,
    [provider, subject],
  );

  if (bySubjectResult.rows.length > 0) {
    // Existing OAuth user — update email in case it changed
    const existing = bySubjectResult.rows[0]!;
    if (existing.email !== email.toLowerCase()) {
      await pool.query(
        `UPDATE users SET email = $1 WHERE id = $2`,
        [email.toLowerCase(), existing.id],
      );
      existing.email = email.toLowerCase();
    }
    return existing;
  }

  // Step 2: Look up by email to detect conflicts
  const byEmailResult = await pool.query<DbOAuthUser>(
    `SELECT id, email, oauth_provider, oauth_subject, tier, created_at
     FROM users
     WHERE email = $1`,
    [email.toLowerCase()],
  );

  if (byEmailResult.rows.length > 0) {
    const existing = byEmailResult.rows[0]!;
    // If the existing account uses a different provider (or is email/password), conflict
    if (existing.oauth_provider !== provider) {
      throw new OAuthEmailConflictError();
    }
    // Same provider but different subject — update subject (shouldn't normally happen)
    const updated = await pool.query<DbOAuthUser>(
      `UPDATE users
       SET oauth_subject = $1
       WHERE id = $2
       RETURNING id, email, oauth_provider, oauth_subject, tier, created_at`,
      [subject, existing.id],
    );
    return updated.rows[0]!;
  }

  // Step 3: Insert new OAuth user
  const inserted = await pool.query<DbOAuthUser>(
    `INSERT INTO users (email, oauth_provider, oauth_subject)
     VALUES ($1, $2, $3)
     RETURNING id, email, oauth_provider, oauth_subject, tier, created_at`,
    [email.toLowerCase(), provider, subject],
  );
  return inserted.rows[0]!;
}

// ---------------------------------------------------------------------------
// High-level OAuth sign-in operation
// ---------------------------------------------------------------------------

export interface OAuthSignInResult {
  token: string;
  userId: string;
  tier: 'free' | 'premium';
}

/**
 * Verifies an OAuth ID token for the given provider, upserts the user,
 * and issues a JWT.
 *
 * @param pool - PostgreSQL connection pool
 * @param keys - RS256 key pair for JWT issuance
 * @param provider - OAuth provider identifier ('google' | 'apple')
 * @param idToken - ID token from the client's native OAuth flow
 */
export async function oauthSignIn(
  pool: Pool,
  keys: JwtKeys,
  provider: string,
  idToken: string,
): Promise<OAuthSignInResult> {
  if (!isSupportedProvider(provider)) {
    throw new UnsupportedProviderError(provider);
  }

  let profile: OAuthProfile;

  if (provider === 'google') {
    const googleClientId = process.env['GOOGLE_CLIENT_ID'];
    profile = await verifyGoogleToken(idToken, googleClientId);
  } else {
    // provider === 'apple'
    const appleClientId = process.env['APPLE_CLIENT_ID'];
    profile = await verifyAppleToken(idToken, appleClientId);
  }

  const user = await upsertOAuthUser(pool, profile);
  const token = issueToken(user.id, user.tier, keys);

  return { token, userId: user.id, tier: user.tier };
}

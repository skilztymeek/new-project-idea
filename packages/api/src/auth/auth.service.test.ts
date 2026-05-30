/**
 * Unit tests for auth.service.ts
 *
 * Covers:
 *  - Email validation: valid formats accepted, invalid formats rejected
 *  - Password validation: ≥ 8 chars accepted, < 8 chars rejected
 *  - JWT payload: contains userId, tier, exp; exp is ~30 days from now
 *  - Duplicate email: second registration with same email returns 409-equivalent error
 *  - Invalid credentials: wrong password throws InvalidCredentialsError
 */

import {
  isValidEmail,
  isValidPassword,
  issueToken,
  verifyToken,
  register,
  login,
  ValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  JwtKeys,
} from './auth.service';
import { generateKeyPairSync } from 'crypto';

// ---------------------------------------------------------------------------
// Test key pair (generated once for the test suite)
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const testKeys: JwtKeys = { privateKey, publicKey };

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

describe('isValidEmail', () => {
  const validEmails = [
    'user@example.com',
    'user.name+tag@sub.domain.org',
    'user123@test.io',
    'a@b.co',
    'USER@EXAMPLE.COM',
    'user@domain.museum',
  ];

  const invalidEmails = [
    '',
    'notanemail',
    '@nodomain.com',
    'noatsign',
    'missing@',
    'spaces in@email.com',
    'double@@at.com',
    'user@',
    '@',
    'user @example.com',
  ];

  test.each(validEmails)('accepts valid email: %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  test.each(invalidEmails)('rejects invalid email: %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Password validation
// ---------------------------------------------------------------------------

describe('isValidPassword', () => {
  test('accepts password with exactly 8 characters', () => {
    expect(isValidPassword('12345678')).toBe(true);
  });

  test('accepts password longer than 8 characters', () => {
    expect(isValidPassword('a very long password 123!')).toBe(true);
  });

  test('rejects password with 7 characters', () => {
    expect(isValidPassword('1234567')).toBe(false);
  });

  test('rejects empty password', () => {
    expect(isValidPassword('')).toBe(false);
  });

  test('rejects password with 1 character', () => {
    expect(isValidPassword('a')).toBe(false);
  });

  test('boundary: 8 chars accepted, 7 chars rejected', () => {
    expect(isValidPassword('abcdefgh')).toBe(true);   // 8 chars
    expect(isValidPassword('abcdefg')).toBe(false);   // 7 chars
  });
});

// ---------------------------------------------------------------------------
// JWT payload
// ---------------------------------------------------------------------------

describe('issueToken / verifyToken', () => {
  test('issued token contains userId, tier, exp, iat, jti', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = issueToken('user-123', 'free', testKeys);
    const after = Math.floor(Date.now() / 1000);

    const payload = verifyToken(token, publicKey);

    expect(payload.userId).toBe('user-123');
    expect(payload.tier).toBe('free');
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(typeof payload.exp).toBe('number');
  });

  test('exp is approximately 30 days after iat', () => {
    const token = issueToken('user-456', 'premium', testKeys);
    const payload = verifyToken(token, publicKey);

    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
    const diff = payload.exp - payload.iat;

    // Allow a 5-second window for test execution time
    expect(diff).toBeGreaterThanOrEqual(thirtyDaysInSeconds - 5);
    expect(diff).toBeLessThanOrEqual(thirtyDaysInSeconds + 5);
  });

  test('exp is ~30 days from now (within 60-second window)', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = issueToken('user-789', 'free', testKeys);
    const payload = verifyToken(token, publicKey);

    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
    const expectedExp = now + thirtyDaysInSeconds;

    expect(payload.exp).toBeGreaterThanOrEqual(expectedExp - 60);
    expect(payload.exp).toBeLessThanOrEqual(expectedExp + 60);
  });

  test('token with premium tier has tier=premium in payload', () => {
    const token = issueToken('user-premium', 'premium', testKeys);
    const payload = verifyToken(token, publicKey);
    expect(payload.tier).toBe('premium');
  });

  test('verifyToken throws on tampered token', () => {
    const token = issueToken('user-123', 'free', testKeys);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyToken(tampered, publicKey)).toThrow();
  });

  test('verifyToken throws on wrong public key', () => {
    const { publicKey: wrongPublicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const token = issueToken('user-123', 'free', testKeys);
    expect(() => verifyToken(token, wrongPublicKey)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// register() — validation errors
// ---------------------------------------------------------------------------

describe('register() validation', () => {
  // Mock pool that should never be called for validation failures
  const mockPool = {} as never;

  test('throws ValidationError for invalid email', async () => {
    await expect(
      register(mockPool, testKeys, 'not-an-email', 'password123'),
    ).rejects.toThrow(ValidationError);
  });

  test('throws ValidationError for short password', async () => {
    await expect(
      register(mockPool, testKeys, 'user@example.com', 'short'),
    ).rejects.toThrow(ValidationError);
  });

  test('ValidationError message mentions email format for bad email', async () => {
    await expect(
      register(mockPool, testKeys, 'bad-email', 'password123'),
    ).rejects.toThrow(/email/i);
  });

  test('ValidationError message mentions password length for short password', async () => {
    await expect(
      register(mockPool, testKeys, 'user@example.com', '1234567'),
    ).rejects.toThrow(/password/i);
  });
});

// ---------------------------------------------------------------------------
// register() — duplicate email (integration-style with mock pool)
// ---------------------------------------------------------------------------

describe('register() duplicate email', () => {
  test('throws DuplicateEmailError when pool returns unique violation', async () => {
    const pgUniqueViolation = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    const mockPool = {
      query: jest.fn().mockRejectedValue(pgUniqueViolation),
    } as never;

    await expect(
      register(mockPool, testKeys, 'existing@example.com', 'password123'),
    ).rejects.toThrow(DuplicateEmailError);
  });

  test('DuplicateEmailError has the correct message', async () => {
    const pgUniqueViolation = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    const mockPool = {
      query: jest.fn().mockRejectedValue(pgUniqueViolation),
    } as never;

    await expect(
      register(mockPool, testKeys, 'existing@example.com', 'password123'),
    ).rejects.toThrow('An account with this email already exists.');
  });
});

// ---------------------------------------------------------------------------
// login() — invalid credentials
// ---------------------------------------------------------------------------

describe('login() invalid credentials', () => {
  test('throws InvalidCredentialsError when user does not exist', async () => {
    const mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as never;

    await expect(
      login(mockPool, testKeys, 'nobody@example.com', 'password123'),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  test('throws InvalidCredentialsError when password is wrong', async () => {
    // bcrypt hash of "correctpassword"
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('correctpassword', 10);

    const mockPool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'user-1',
            email: 'user@example.com',
            password_hash: hash,
            tier: 'free',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    } as never;

    await expect(
      login(mockPool, testKeys, 'user@example.com', 'wrongpassword'),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  test('InvalidCredentialsError has generic message (no enumeration)', async () => {
    const mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as never;

    let error: Error | null = null;
    try {
      await login(mockPool, testKeys, 'nobody@example.com', 'password123');
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeInstanceOf(InvalidCredentialsError);
    // Message should not reveal whether email or password was wrong
    expect(error!.message).toBe('Invalid credentials.');
    expect(error!.message.toLowerCase()).not.toContain('email');
    expect(error!.message.toLowerCase()).not.toContain('password');
  });

  test('returns token on successful login', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('correctpassword', 10);

    const mockPool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'user-1',
            email: 'user@example.com',
            password_hash: hash,
            tier: 'free',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    } as never;

    const result = await login(
      mockPool,
      testKeys,
      'user@example.com',
      'correctpassword',
    );

    expect(result.token).toBeTruthy();
    expect(result.userId).toBe('user-1');
    expect(result.tier).toBe('free');

    // Verify the issued token is valid
    const payload = verifyToken(result.token, publicKey);
    expect(payload.userId).toBe('user-1');
  });
});

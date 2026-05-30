/**
 * JWT authentication middleware.
 *
 * Extracts the Bearer token from the Authorization header, verifies the
 * RS256 signature, checks the Redis revocation list, and attaches the
 * decoded payload to `req.user`.
 *
 * Usage:
 *   router.get('/protected', requireAuth, handler)
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, isTokenRevoked, TokenPayload } from './auth.service';
import { getRedis } from '../redis/client';

// Extend Express Request to carry the decoded JWT payload
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Reads JWT_PUBLIC_KEY from the environment.
 * Throws if the variable is not set.
 */
function getPublicKey(): string {
  const key = process.env['JWT_PUBLIC_KEY'];
  if (!key) {
    throw new Error('JWT_PUBLIC_KEY environment variable is not set.');
  }
  // Support newline-escaped keys stored in env vars
  return key.replace(/\\n/g, '\n');
}

/**
 * Express middleware that enforces JWT authentication.
 * Responds with 401 if the token is missing, invalid, expired, or revoked.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const publicKey = getPublicKey();
    const payload = verifyToken(token, publicKey);

    // Check revocation list
    const redis = getRedis();
    const revoked = await isTokenRevoked(redis, payload.jti);
    if (revoked) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid credentials.' });
  }
}

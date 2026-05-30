/**
 * Auth Router — Express router for authentication endpoints.
 *
 * Endpoints:
 *   POST /auth/register          — email/password registration
 *   POST /auth/login             — email/password login
 *   POST /auth/logout            — invalidate session (requires auth)
 *   GET  /auth/session           — validate session and return user info (requires auth)
 *   POST /auth/oauth/:provider   — Google / Apple OAuth sign-in
 */

import { Router, Request, Response } from 'express';
import {
  register,
  login,
  revokeToken,
  findUserById,
  ValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  JwtKeys,
} from './auth.service';
import {
  oauthSignIn,
  UnsupportedProviderError,
  InvalidOAuthTokenError,
  OAuthEmailConflictError,
} from './oauth.service';
import { requireAuth } from './auth.middleware';
import { getPool } from '../db/client';
import { getRedis } from '../redis/client';

/**
 * Reads RS256 key pair from environment variables.
 * Supports newline-escaped PEM keys (common in env var storage).
 */
function getJwtKeys(): JwtKeys {
  const privateKey = process.env['JWT_PRIVATE_KEY'];
  const publicKey = process.env['JWT_PUBLIC_KEY'];

  if (!privateKey || !publicKey) {
    throw new Error(
      'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment variables must be set.',
    );
  }

  return {
    privateKey: privateKey.replace(/\\n/g, '\n'),
    publicKey: publicKey.replace(/\\n/g, '\n'),
  };
}

export function createAuthRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // POST /auth/register
  // -------------------------------------------------------------------------
  router.post('/register', async (req: Request, res: Response) => {
    const { email, password } = req.body as {
      email?: unknown;
      password?: unknown;
    };

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }

    try {
      const keys = getJwtKeys();
      const pool = getPool();
      const result = await register(pool, keys, email, password);

      res.status(201).json({
        token: result.token,
        userId: result.userId,
        tier: result.tier,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof DuplicateEmailError) {
        res.status(409).json({ error: err.message });
      } else {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as {
      email?: unknown;
      password?: unknown;
    };

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }

    try {
      const keys = getJwtKeys();
      const pool = getPool();
      const result = await login(pool, keys, email, password);

      res.status(200).json({
        token: result.token,
        userId: result.userId,
        tier: result.tier,
      });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({ error: 'Invalid credentials.' });
      } else {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /auth/logout  (requires auth)
  // -------------------------------------------------------------------------
  router.post('/logout', requireAuth, async (req: Request, res: Response) => {
    try {
      const { jti, exp } = req.user!;
      const redis = getRedis();
      await revokeToken(redis, jti, exp);

      res.status(200).json({ message: 'Logged out successfully.' });
    } catch (err) {
      console.error('Logout error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /auth/session  (requires auth)
  // -------------------------------------------------------------------------
  router.get('/session', requireAuth, async (req: Request, res: Response) => {
    try {
      const pool = getPool();
      const user = await findUserById(pool, req.user!.userId);

      if (!user) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }

      res.status(200).json({
        userId: user.id,
        email: user.email,
        tier: user.tier,
        createdAt: user.created_at,
      });
    } catch (err) {
      console.error('Session error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /auth/oauth/:provider
  // -------------------------------------------------------------------------
  router.post('/oauth/:provider', async (req: Request, res: Response) => {
    const { provider } = req.params as { provider: string };
    const { idToken } = req.body as { idToken?: unknown };

    if (typeof idToken !== 'string' || idToken.trim() === '') {
      res.status(400).json({ error: 'idToken is required.' });
      return;
    }

    try {
      const keys = getJwtKeys();
      const pool = getPool();
      const result = await oauthSignIn(pool, keys, provider, idToken);

      res.status(200).json({
        token: result.token,
        userId: result.userId,
        tier: result.tier,
      });
    } catch (err) {
      if (err instanceof UnsupportedProviderError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof InvalidOAuthTokenError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof OAuthEmailConflictError) {
        res.status(409).json({ error: err.message });
      } else {
        console.error('OAuth sign-in error:', err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  });

  return router;
}

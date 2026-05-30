/**
 * NYC Subway Virtual Tour — API Service entry point.
 *
 * Environment variables:
 *   PORT            — HTTP port (default: 3000)
 *   DATABASE_URL    — PostgreSQL connection string
 *   REDIS_URL       — Redis connection string (default: redis://localhost:6379)
 *   JWT_PRIVATE_KEY — PEM-encoded RSA private key (RS256)
 *   JWT_PUBLIC_KEY  — PEM-encoded RSA public key (RS256)
 */

import 'dotenv/config';
import express from 'express';
import { createAuthRouter } from './auth/auth.router';
import { createStationRouter } from './stations/station.router';

export const API_VERSION = '1.0.0';

const app = express();

// Parse JSON request bodies
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: API_VERSION });
});

// Auth routes
app.use('/auth', createAuthRouter());

// Station routes
app.use('/stations', createStationRouter());

// Start server only when run directly (not imported in tests)
if (require.main === module) {
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  app.listen(port, () => {
    console.log(`NYC Subway Tour API listening on port ${port}`);
  });
}

export default app;

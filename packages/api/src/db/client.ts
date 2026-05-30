/**
 * PostgreSQL connection pool singleton.
 *
 * Environment variables:
 *   DATABASE_URL — PostgreSQL connection string
 *                  e.g. postgres://user:pass@localhost:5432/nyc_subway_tour
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Returns the shared pg Pool instance, creating it on first call.
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set.');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Closes the pool. Useful for graceful shutdown and tests.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

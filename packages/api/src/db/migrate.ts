/**
 * Migration runner for the NYC Subway Virtual Tour API.
 *
 * Applies all SQL migration files in `packages/api/migrations/` in
 * lexicographic (filename) order.  Each migration is wrapped in a
 * transaction so a failure leaves the database in a clean state.
 * Already-applied migrations are tracked in the `schema_migrations`
 * table and skipped on subsequent runs.
 *
 * Usage:
 *   npx ts-node src/db/migrate.ts
 *
 * Environment variables (required):
 *   DATABASE_URL  — PostgreSQL connection string
 *                   e.g. postgres://user:pass@localhost:5432/nyc_subway_tour
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/**
 * Returns the sorted list of .sql filenames in the migrations directory.
 */
function getMigrationFiles(): string[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic order — relies on numeric prefixes (000_, 001_, …)
  return files;
}

/**
 * Returns the set of migration filenames that have already been applied.
 */
async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((r) => r.filename));
}

/**
 * Applies a single migration file inside a transaction.
 * Records the filename in `schema_migrations` on success.
 */
async function applyMigration(client: Client, filename: string): Promise<void> {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename],
    );
    await client.query('COMMIT');
    console.log(`  ✓ Applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(
      `Migration failed for "${filename}": ${(err as Error).message}`,
    );
  }
}

/**
 * Main entry point.  Connects to the database, bootstraps the tracking
 * table, then applies any pending migrations in order.
 */
async function runMigrations(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('Running migrations…');

    // Bootstrap: ensure the tracking table exists before anything else.
    // This DDL is idempotent (IF NOT EXISTS) so it is safe to run every time.
    const bootstrapSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '000_create_migrations_table.sql'),
      'utf8',
    );
    await client.query(bootstrapSql);

    const allFiles = getMigrationFiles();
    const applied = await getAppliedMigrations(client);

    const pending = allFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('No pending migrations — database is up to date.');
      return;
    }

    for (const filename of pending) {
      await applyMigration(client, filename);
    }

    console.log(`\nDone. Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

// Run when executed directly (not imported as a module)
if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Migration error:', err.message);
    process.exit(1);
  });
}

export { runMigrations };

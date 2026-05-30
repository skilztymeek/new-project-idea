-- Migration 000: Create the schema_migrations tracking table
-- This table records which migration files have already been applied,
-- allowing the runner to skip already-applied migrations on subsequent runs.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

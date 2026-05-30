-- Migration 001: Create users table
-- Stores registered user accounts (email/password and OAuth)

CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT,                          -- NULL for OAuth-only accounts
  oauth_provider      TEXT CHECK (oauth_provider IN ('google', 'apple')),
  oauth_subject       TEXT,                          -- provider-specific user ID
  tier                TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  premium_expires_at  TIMESTAMPTZ,                   -- NULL for free-tier users
  billing_issue       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for OAuth lookups (provider + subject uniquely identifies a user)
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_idx
  ON users (oauth_provider, oauth_subject)
  WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL;

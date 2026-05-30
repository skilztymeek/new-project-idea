-- Migration 005: Create favorites table
-- Stores stations that authenticated users have marked as favorites

CREATE TABLE IF NOT EXISTS favorites (
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  station_id  TEXT NOT NULL REFERENCES stations (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A user can only favorite a given station once
  CONSTRAINT favorites_user_station_unique UNIQUE (user_id, station_id)
);

-- Index for fetching all favorites for a given user
CREATE INDEX IF NOT EXISTS favorites_user_id_idx
  ON favorites (user_id);

-- Index for checking whether a specific station is favorited by a user
CREATE INDEX IF NOT EXISTS favorites_user_station_idx
  ON favorites (user_id, station_id);

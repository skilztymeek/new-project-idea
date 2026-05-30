-- Migration 006: Create history table
-- Tracks the stations an authenticated user has visited (last 50, upserted on re-visit)

CREATE TABLE IF NOT EXISTS history (
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  station_id  TEXT NOT NULL REFERENCES stations (id) ON DELETE CASCADE,
  visited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each (user, station) pair has exactly one history entry; re-visits update visited_at
  CONSTRAINT history_user_station_unique UNIQUE (user_id, station_id)
);

-- Index for fetching a user's history ordered by most recent visit
CREATE INDEX IF NOT EXISTS history_user_id_visited_at_idx
  ON history (user_id, visited_at DESC);

-- ---------------------------------------------------------------------------
-- Upsert helper: insert or update a history entry.
-- Call this instead of a plain INSERT to enforce the deduplication rule.
--
-- Usage:
--   SELECT upsert_history('<user_uuid>', '<station_id>');
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_history(
  p_user_id    UUID,
  p_station_id TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO history (user_id, station_id, visited_at)
  VALUES (p_user_id, p_station_id, NOW())
  ON CONFLICT (user_id, station_id)
  DO UPDATE SET visited_at = NOW();

  -- Evict oldest entries beyond the 50-entry cap for this user.
  -- This is a safety net; the application layer should also enforce the cap.
  DELETE FROM history
  WHERE user_id = p_user_id
    AND station_id NOT IN (
      SELECT station_id
      FROM history
      WHERE user_id = p_user_id
      ORDER BY visited_at DESC
      LIMIT 50
    );
END;
$$ LANGUAGE plpgsql;

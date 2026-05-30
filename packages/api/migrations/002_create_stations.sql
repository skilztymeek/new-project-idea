-- Migration 002: Create stations table
-- Stores NYC subway station metadata (sourced from MTA GTFS static feed)

CREATE TABLE IF NOT EXISTS stations (
  id                  TEXT PRIMARY KEY,              -- GTFS stop_id (e.g., "101")
  name                TEXT NOT NULL,
  borough             TEXT NOT NULL CHECK (borough IN ('Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island')),
  lines               TEXT[] NOT NULL DEFAULT '{}',  -- e.g., ARRAY['1','2','3','N','Q','R']
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,
  ada_accessible      BOOLEAN NOT NULL DEFAULT FALSE,
  opening_year        INTEGER,                       -- NULL if unknown
  notable_features    TEXT,
  primary_scene_id    TEXT NOT NULL DEFAULT '',      -- FK to scenes.id; set after scenes are inserted
  download_size_bytes BIGINT NOT NULL DEFAULT 0,

  -- Full-text search vector: populated from name, borough, and lines
  search_vector       TSVECTOR
);

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS stations_search_vector_idx
  ON stations USING GIN (search_vector);

-- Index for geographic proximity queries (borough filter)
CREATE INDEX IF NOT EXISTS stations_borough_idx
  ON stations (borough);

-- Function to compute the search_vector from station fields
CREATE OR REPLACE FUNCTION stations_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('english',
      COALESCE(NEW.name, '') || ' ' ||
      COALESCE(NEW.borough, '') || ' ' ||
      COALESCE(array_to_string(NEW.lines, ' '), '')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to keep search_vector up to date on insert/update
CREATE TRIGGER stations_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, borough, lines
  ON stations
  FOR EACH ROW
  EXECUTE FUNCTION stations_search_vector_update();

-- Backfill search_vector for any rows already present
UPDATE stations
SET search_vector =
  to_tsvector('english',
    COALESCE(name, '') || ' ' ||
    COALESCE(borough, '') || ' ' ||
    COALESCE(array_to_string(lines, ' '), '')
  );

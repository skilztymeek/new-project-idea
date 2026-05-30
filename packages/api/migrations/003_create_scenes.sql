-- Migration 003: Create scenes table
-- Each scene is a single 360-degree panoramic capture within a station

CREATE TABLE IF NOT EXISTS scenes (
  id                  TEXT PRIMARY KEY,
  station_id          TEXT NOT NULL REFERENCES stations (id) ON DELETE CASCADE,
  area_label          TEXT NOT NULL,                -- e.g., "Northbound Platform", "Mezzanine"
  panorama_url        TEXT NOT NULL,                -- CDN URL to equirectangular image or tile manifest
  thumbnail_url       TEXT NOT NULL,
  minimap_position_x  DOUBLE PRECISION NOT NULL DEFAULT 0.5,  -- normalized [0, 1]
  minimap_position_y  DOUBLE PRECISION NOT NULL DEFAULT 0.5,  -- normalized [0, 1]
  captured_at         TIMESTAMPTZ NOT NULL
);

-- Index for fetching all scenes belonging to a station
CREATE INDEX IF NOT EXISTS scenes_station_id_idx
  ON scenes (station_id);

-- Now that scenes exist, add the FK constraint on stations.primary_scene_id.
-- We use a deferred approach: the column is plain TEXT during seeding and
-- the application layer validates referential integrity.  A formal FK can be
-- added once the data pipeline guarantees every station has at least one scene.

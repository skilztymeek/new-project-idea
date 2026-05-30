-- Migration 004: Create hotspots table
-- Interactive markers within a scene that link to adjacent scenes or provide info

CREATE TABLE IF NOT EXISTS hotspots (
  id              TEXT PRIMARY KEY,
  scene_id        TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  linked_scene_id TEXT NOT NULL,                    -- target scene for navigation hotspots
  yaw             DOUBLE PRECISION NOT NULL,         -- degrees, -180 to 180
  pitch           DOUBLE PRECISION NOT NULL,         -- degrees, -90 to 90
  label           TEXT NOT NULL,                    -- e.g., "→ Southbound Platform"
  type            TEXT NOT NULL CHECK (type IN ('navigation', 'info')),
  info_content    TEXT                              -- only populated for type = 'info'
);

-- Index for fetching all hotspots belonging to a scene
CREATE INDEX IF NOT EXISTS hotspots_scene_id_idx
  ON hotspots (scene_id);

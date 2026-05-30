/**
 * Station Service — DB query logic for station index, search, and metadata.
 *
 * Responsibilities:
 *  - Paginated station list
 *  - Full-text search using PostgreSQL tsvector (search_vector column)
 *  - Station detail with scenes
 *  - Scene detail with hotspots
 *  - Suggestions (popular by visit count, or nearby by lat/lng) when search returns no results
 */

import { Pool } from 'pg';
import { Station, Scene, Hotspot } from '@nyc-subway-tour/shared';

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface DbStation {
  id: string;
  name: string;
  borough: 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Staten Island';
  lines: string[];
  lat: number;
  lng: number;
  ada_accessible: boolean;
  opening_year: number | null;
  notable_features: string | null;
  primary_scene_id: string;
  download_size_bytes: string; // pg returns bigint as string
  visit_count?: string;
}

interface DbScene {
  id: string;
  station_id: string;
  area_label: string;
  panorama_url: string;
  thumbnail_url: string;
  minimap_position_x: number;
  minimap_position_y: number;
  captured_at: string;
}

interface DbHotspot {
  id: string;
  scene_id: string;
  linked_scene_id: string;
  yaw: number;
  pitch: number;
  label: string;
  type: 'navigation' | 'info';
  info_content: string | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapDbStationToStation(row: DbStation, scenes: Scene[] = []): Station {
  return {
    id: row.id,
    name: row.name,
    borough: row.borough,
    lines: row.lines,
    coordinates: { lat: row.lat, lng: row.lng },
    adaAccessible: row.ada_accessible,
    openingYear: row.opening_year,
    notableFeatures: row.notable_features,
    primarySceneId: row.primary_scene_id,
    scenes,
    downloadSizeBytes: parseInt(row.download_size_bytes, 10) || 0,
  };
}

function mapDbSceneToScene(row: DbScene, hotspots: Hotspot[] = []): Scene {
  return {
    id: row.id,
    stationId: row.station_id,
    areaLabel: row.area_label,
    panoramaUrl: row.panorama_url,
    thumbnailUrl: row.thumbnail_url,
    hotspots,
    minimapPosition: {
      x: row.minimap_position_x,
      y: row.minimap_position_y,
    },
    capturedAt: row.captured_at,
  };
}

function mapDbHotspotToHotspot(row: DbHotspot): Hotspot {
  const hotspot: Hotspot = {
    id: row.id,
    sceneId: row.scene_id,
    linkedSceneId: row.linked_scene_id,
    yaw: row.yaw,
    pitch: row.pitch,
    label: row.label,
    type: row.type,
  };
  if (row.info_content !== null) {
    hotspot.infoContent = row.info_content;
  }
  return hotspot;
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class StationNotFoundError extends Error {
  constructor(id: string) {
    super(`Station not found: ${id}`);
    this.name = 'StationNotFoundError';
  }
}

export class SceneNotFoundError extends Error {
  constructor(sceneId: string, stationId: string) {
    super(`Scene not found: ${sceneId} in station ${stationId}`);
    this.name = 'SceneNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedStationsResult {
  stations: Station[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Returns a paginated list of all stations (no scenes/hotspots included).
 */
export async function listStations(
  pool: Pool,
  page: number,
  pageSize: number,
): Promise<PaginatedStationsResult> {
  const offset = (page - 1) * pageSize;

  const [rowsResult, countResult] = await Promise.all([
    pool.query<DbStation>(
      `SELECT id, name, borough, lines, lat, lng, ada_accessible,
              opening_year, notable_features, primary_scene_id, download_size_bytes
       FROM stations
       ORDER BY name ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ),
    pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM stations'),
  ]);

  const stations = rowsResult.rows.map((row) => mapDbStationToStation(row, []));
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  return { stations, total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchStationsResult {
  stations: Station[];
  total: number;
  suggestions?: Station[];
}

/**
 * Full-text search using the tsvector search_vector column.
 * Supports optional borough and line filters.
 * When no results are found, returns suggestions (popular by visit count,
 * or nearby by lat/lng if coordinates are provided).
 */
export async function searchStations(
  pool: Pool,
  query: string,
  borough?: string,
  line?: string,
  lat?: number,
  lng?: number,
): Promise<SearchStationsResult> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  // Full-text search condition
  if (query && query.trim().length > 0) {
    params.push(query.trim());
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
  }

  // Borough filter
  if (borough && borough.trim().length > 0) {
    params.push(borough.trim());
    conditions.push(`borough = $${params.length}`);
  }

  // Line filter
  if (line && line.trim().length > 0) {
    params.push(line.trim());
    conditions.push(`$${params.length} = ANY(lines)`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY: rank by relevance when there's a text query, else by name
  let orderBy = 'ORDER BY name ASC';
  if (query && query.trim().length > 0) {
    orderBy = `ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC, name ASC`;
  }

  const sql = `
    SELECT id, name, borough, lines, lat, lng, ada_accessible,
           opening_year, notable_features, primary_scene_id, download_size_bytes
    FROM stations
    ${whereClause}
    ${orderBy}
    LIMIT 50
  `;

  const result = await pool.query<DbStation>(sql, params);
  const stations = result.rows.map((row) => mapDbStationToStation(row, []));

  if (stations.length > 0) {
    return { stations, total: stations.length };
  }

  // No results — return suggestions
  const suggestions = await getSuggestions(pool, lat, lng);
  return { stations: [], total: 0, suggestions };
}

/**
 * Returns up to 5 suggestion stations.
 * If lat/lng are provided, returns nearby stations by geo proximity.
 * Otherwise returns popular stations by visit count (history table).
 */
async function getSuggestions(
  pool: Pool,
  lat?: number,
  lng?: number,
): Promise<Station[]> {
  let sql: string;
  let params: unknown[];

  if (lat !== undefined && lng !== undefined) {
    // Nearby stations by Euclidean distance (approximate, no PostGIS required)
    sql = `
      SELECT id, name, borough, lines, lat, lng, ada_accessible,
             opening_year, notable_features, primary_scene_id, download_size_bytes
      FROM stations
      ORDER BY ((lat - $1) * (lat - $1) + (lng - $2) * (lng - $2)) ASC
      LIMIT 5
    `;
    params = [lat, lng];
  } else {
    // Popular stations by visit count from history table
    sql = `
      SELECT s.id, s.name, s.borough, s.lines, s.lat, s.lng, s.ada_accessible,
             s.opening_year, s.notable_features, s.primary_scene_id, s.download_size_bytes,
             COUNT(h.station_id) AS visit_count
      FROM stations s
      LEFT JOIN history h ON h.station_id = s.id
      GROUP BY s.id
      ORDER BY visit_count DESC, s.name ASC
      LIMIT 5
    `;
    params = [];
  }

  const result = await pool.query<DbStation>(sql, params);
  return result.rows.map((row) => mapDbStationToStation(row, []));
}

// ---------------------------------------------------------------------------
// Station detail
// ---------------------------------------------------------------------------

/**
 * Returns a station with its full scenes array (each scene includes hotspots).
 * Throws StationNotFoundError if the station does not exist.
 */
export async function getStationById(
  pool: Pool,
  id: string,
): Promise<Station> {
  const stationResult = await pool.query<DbStation>(
    `SELECT id, name, borough, lines, lat, lng, ada_accessible,
            opening_year, notable_features, primary_scene_id, download_size_bytes
     FROM stations
     WHERE id = $1`,
    [id],
  );

  if (stationResult.rows.length === 0) {
    throw new StationNotFoundError(id);
  }

  const dbStation = stationResult.rows[0]!;

  // Fetch all scenes for this station
  const scenesResult = await pool.query<DbScene>(
    `SELECT id, station_id, area_label, panorama_url, thumbnail_url,
            minimap_position_x, minimap_position_y, captured_at
     FROM scenes
     WHERE station_id = $1
     ORDER BY captured_at ASC`,
    [id],
  );

  // Fetch all hotspots for all scenes in one query
  const sceneIds = scenesResult.rows.map((s) => s.id);
  let hotspotsByScene: Map<string, Hotspot[]> = new Map();

  if (sceneIds.length > 0) {
    const hotspotsResult = await pool.query<DbHotspot>(
      `SELECT id, scene_id, linked_scene_id, yaw, pitch, label, type, info_content
       FROM hotspots
       WHERE scene_id = ANY($1)`,
      [sceneIds],
    );

    hotspotsByScene = hotspotsResult.rows.reduce((acc, row) => {
      const hotspot = mapDbHotspotToHotspot(row);
      const existing = acc.get(row.scene_id) ?? [];
      existing.push(hotspot);
      acc.set(row.scene_id, existing);
      return acc;
    }, new Map<string, Hotspot[]>());
  }

  const scenes = scenesResult.rows.map((row) =>
    mapDbSceneToScene(row, hotspotsByScene.get(row.id) ?? []),
  );

  return mapDbStationToStation(dbStation, scenes);
}

// ---------------------------------------------------------------------------
// Scene detail
// ---------------------------------------------------------------------------

/**
 * Returns a single scene with its hotspots.
 * Throws StationNotFoundError if the station does not exist.
 * Throws SceneNotFoundError if the scene does not exist or does not belong to the station.
 */
export async function getSceneById(
  pool: Pool,
  stationId: string,
  sceneId: string,
): Promise<Scene> {
  // Verify station exists
  const stationResult = await pool.query<{ id: string }>(
    'SELECT id FROM stations WHERE id = $1',
    [stationId],
  );

  if (stationResult.rows.length === 0) {
    throw new StationNotFoundError(stationId);
  }

  // Fetch scene (must belong to this station)
  const sceneResult = await pool.query<DbScene>(
    `SELECT id, station_id, area_label, panorama_url, thumbnail_url,
            minimap_position_x, minimap_position_y, captured_at
     FROM scenes
     WHERE id = $1 AND station_id = $2`,
    [sceneId, stationId],
  );

  if (sceneResult.rows.length === 0) {
    throw new SceneNotFoundError(sceneId, stationId);
  }

  const dbScene = sceneResult.rows[0]!;

  // Fetch hotspots for this scene
  const hotspotsResult = await pool.query<DbHotspot>(
    `SELECT id, scene_id, linked_scene_id, yaw, pitch, label, type, info_content
     FROM hotspots
     WHERE scene_id = $1`,
    [sceneId],
  );

  const hotspots = hotspotsResult.rows.map(mapDbHotspotToHotspot);
  return mapDbSceneToScene(dbScene, hotspots);
}

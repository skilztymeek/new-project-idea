/**
 * Seed script: populate the `stations` table from MTA GTFS static feed.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node src/db/seed-stations.ts [--gtfs-path /path/to/stops.txt]
 *
 * Without --gtfs-path the script downloads the MTA GTFS zip from
 * https://api.mta.info/GTFS.zip, extracts stops.txt, and uses that.
 *
 * Environment variables:
 *   DATABASE_URL  — PostgreSQL connection string (required)
 *
 * The script is idempotent: it uses INSERT … ON CONFLICT (id) DO UPDATE
 * so it can be re-run safely.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'csv-parse/sync';
import AdmZip from 'adm-zip';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type: string;
  parent_station: string;
}

export interface StationRow {
  id: string;
  name: string;
  borough: string;
  lines: string[];
  lat: number;
  lng: number;
  ada_accessible: boolean;
  primary_scene_id: string;
  download_size_bytes: number;
}

// ---------------------------------------------------------------------------
// Borough inference
// ---------------------------------------------------------------------------

/**
 * Infer the NYC borough from an MTA GTFS stop_id.
 *
 * MTA numeric prefixes:
 *   1xx  → Manhattan
 *   2xx  → Bronx
 *   3xx  → Brooklyn
 *   4xx  → Queens
 *   5xx  → Staten Island
 *
 * Letter-prefixed stop IDs (e.g. "A27", "R03") are used for specific lines;
 * we fall back to a line-based heuristic for those.
 */
export function inferBorough(stopId: string): string {
  // Strip trailing direction suffix (N/S) that MTA appends to child stops
  const base = stopId.replace(/[NS]$/, '');

  const numeric = parseInt(base, 10);
  if (!isNaN(numeric)) {
    if (numeric >= 100 && numeric < 200) return 'Manhattan';
    if (numeric >= 200 && numeric < 300) return 'Bronx';
    if (numeric >= 300 && numeric < 400) return 'Brooklyn';
    if (numeric >= 400 && numeric < 500) return 'Queens';
    if (numeric >= 500 && numeric < 600) return 'Staten Island';
  }

  // Letter-prefixed IDs: use first character heuristic based on MTA line geography
  const prefix = base.charAt(0).toUpperCase();

  // Lines that run primarily in Manhattan
  if (['1', '2', '3', '4', '5', '6', '7'].includes(prefix)) return 'Manhattan';

  // A/C/E: runs through Manhattan, Brooklyn, Queens — default Manhattan
  if (prefix === 'A') return 'Manhattan';
  // B/D: Manhattan + Brooklyn
  if (prefix === 'B') return 'Brooklyn';
  // F/M: Manhattan + Queens + Brooklyn
  if (prefix === 'F') return 'Queens';
  // G: Brooklyn + Queens
  if (prefix === 'G') return 'Brooklyn';
  // J/Z: Brooklyn + Queens
  if (prefix === 'J') return 'Brooklyn';
  // L: Manhattan + Brooklyn
  if (prefix === 'L') return 'Brooklyn';
  // N/Q/R/W: Manhattan + Brooklyn + Queens
  if (prefix === 'N') return 'Queens';
  // R: Manhattan + Brooklyn + Queens
  if (prefix === 'R') return 'Queens';
  // S: shuttle lines (various)
  if (prefix === 'S') return 'Manhattan';

  // Fallback
  return 'Manhattan';
}

// ---------------------------------------------------------------------------
// Lines mapping
// ---------------------------------------------------------------------------

/**
 * Hardcoded mapping of MTA parent station stop_id to subway lines.
 *
 * This covers the major stations. For stations not in this map the lines
 * array will be empty (to be filled in later via a full GTFS join).
 *
 * The full authoritative mapping requires joining stops.txt → stop_times.txt
 * → trips.txt → routes.txt, which is expensive for a seed script. This
 * hardcoded map covers the most important stations and can be extended.
 */
export const STATION_LINES_MAP: Record<string, string[]> = {
  // Times Square - 42 St
  '127': ['1', '2', '3'],
  '725': ['N', 'Q', 'R', 'W'],
  '902': ['7'],
  // Grand Central - 42 St
  '132': ['4', '5', '6'],
  '901': ['7'],
  // Union Square - 14 St
  '635': ['4', '5', '6'],
  'R20': ['N', 'Q', 'R', 'W'],
  'L03': ['L'],
  // Atlantic Av - Barclays Ctr
  'D24': ['B', 'D', 'N', 'Q', 'R'],
  'A41': ['A', 'C'],
  '236': ['2', '3', '4', '5'],
  // Fulton St
  'A38': ['A', 'C'],
  '229': ['2', '3'],
  '418': ['4', '5'],
  'R29': ['R'],
  'J27': ['J', 'Z'],
  // 34 St - Penn Station
  '120': ['1', '2', '3'],
  'R17': ['N', 'Q', 'R', 'W'],
  // 34 St - Herald Sq
  'B08': ['B', 'D', 'F', 'M'],
  // 59 St - Columbus Circle
  '117': ['1'],
  'A09': ['A', 'B', 'C', 'D'],
  // 125 St
  '123': ['1'],
  '204': ['2', '3'],
  '416': ['4', '5', '6'],
  'A11': ['A', 'B', 'C', 'D'],
};

/**
 * Look up lines for a given stop_id. Returns an empty array if unknown.
 */
export function getLinesForStation(stopId: string): string[] {
  return STATION_LINES_MAP[stopId] ?? [];
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse the content of a GTFS stops.txt CSV file.
 * Returns all rows as GtfsStop objects.
 */
export function parseStopsCsv(csvContent: string): GtfsStop[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((r) => ({
    stop_id: r['stop_id'] ?? '',
    stop_name: r['stop_name'] ?? '',
    stop_lat: r['stop_lat'] ?? '',
    stop_lon: r['stop_lon'] ?? '',
    location_type: r['location_type'] ?? '',
    parent_station: r['parent_station'] ?? '',
  }));
}

/**
 * Filter GTFS stops to only parent subway stations.
 *
 * MTA GTFS uses location_type=1 for parent stations (the station itself)
 * and location_type=0 (or empty) for individual stop platforms (child stops).
 *
 * We keep only location_type=1 rows, which represent the station as a whole.
 * If no location_type=1 rows exist (some older GTFS exports omit this field),
 * we fall back to stops that have no parent_station (i.e., they are roots).
 */
export function filterParentStations(stops: GtfsStop[]): GtfsStop[] {
  const parentStations = stops.filter((s) => s.location_type === '1');
  if (parentStations.length > 0) {
    return parentStations;
  }
  // Fallback: stops with no parent_station and no direction suffix
  return stops.filter(
    (s) =>
      !s.parent_station &&
      s.stop_id !== '' &&
      !/[NS]$/.test(s.stop_id),
  );
}

/**
 * Map a GtfsStop to a StationRow for database insertion.
 */
export function mapStopToStation(stop: GtfsStop): StationRow {
  return {
    id: stop.stop_id,
    name: stop.stop_name,
    borough: inferBorough(stop.stop_id),
    lines: getLinesForStation(stop.stop_id),
    lat: parseFloat(stop.stop_lat) || 0,
    lng: parseFloat(stop.stop_lon) || 0,
    ada_accessible: false, // not available in stops.txt; can be updated later
    primary_scene_id: '', // populated after scenes are inserted
    download_size_bytes: 0,
  };
}

// ---------------------------------------------------------------------------
// GTFS download
// ---------------------------------------------------------------------------

const GTFS_ZIP_URL = 'https://api.mta.info/GTFS.zip';

/**
 * Download the MTA GTFS zip and extract stops.txt content.
 * Uses Node 18+ built-in fetch.
 */
export async function downloadStopsTxt(): Promise<string> {
  console.log(`Downloading GTFS feed from ${GTFS_ZIP_URL} …`);

  const response = await fetch(GTFS_ZIP_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download GTFS zip: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Write to a temp file so AdmZip can read it
  const tmpPath = path.join(os.tmpdir(), `gtfs-${Date.now()}.zip`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const zip = new AdmZip(tmpPath);
    const entry = zip.getEntry('stops.txt');
    if (!entry) {
      throw new Error('stops.txt not found in GTFS zip archive');
    }
    return entry.getData().toString('utf8');
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// Database upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of station rows into the `stations` table.
 * Uses INSERT … ON CONFLICT (id) DO UPDATE for idempotency.
 */
export async function upsertStations(
  client: Client,
  stations: StationRow[],
): Promise<number> {
  let upsertedCount = 0;

  for (const station of stations) {
    await client.query(
      `INSERT INTO stations
         (id, name, borough, lines, lat, lng, ada_accessible, primary_scene_id, download_size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name                = EXCLUDED.name,
         borough             = EXCLUDED.borough,
         lines               = EXCLUDED.lines,
         lat                 = EXCLUDED.lat,
         lng                 = EXCLUDED.lng,
         ada_accessible      = EXCLUDED.ada_accessible,
         primary_scene_id    = EXCLUDED.primary_scene_id,
         download_size_bytes = EXCLUDED.download_size_bytes`,
      [
        station.id,
        station.name,
        station.borough,
        station.lines,
        station.lat,
        station.lng,
        station.ada_accessible,
        station.primary_scene_id,
        station.download_size_bytes,
      ],
    );
    upsertedCount++;
  }

  return upsertedCount;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }

  // Parse CLI args
  const args = process.argv.slice(2);
  const gtfsPathIdx = args.indexOf('--gtfs-path');
  const gtfsPath = gtfsPathIdx !== -1 ? args[gtfsPathIdx + 1] : undefined;

  // Obtain stops.txt content
  let stopsCsvContent: string;
  if (gtfsPath) {
    console.log(`Reading stops.txt from ${gtfsPath} …`);
    stopsCsvContent = fs.readFileSync(gtfsPath, 'utf8');
  } else {
    stopsCsvContent = await downloadStopsTxt();
  }

  // Parse and filter
  const allStops = parseStopsCsv(stopsCsvContent);
  console.log(`Parsed ${allStops.length} total stops from GTFS feed.`);

  const parentStations = filterParentStations(allStops);
  console.log(`Filtered to ${parentStations.length} parent stations.`);

  const stationRows = parentStations.map(mapStopToStation);

  // Connect and upsert
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const count = await upsertStations(client, stationRows);
    console.log(`\nUpserted ${count} station(s) into the stations table.`);

    // Verify minimum count
    const result = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM stations',
    );
    const totalInDb = parseInt(result.rows[0]?.count ?? '0', 10);
    console.log(`Total stations in database: ${totalInDb}`);

    if (totalInDb < 400) {
      throw new Error(
        `Assertion failed: expected at least 400 stations in the database, but found ${totalInDb}. ` +
          'Check that the GTFS feed contains all MTA subway stations.',
      );
    }

    console.log(`✓ Assertion passed: ${totalInDb} >= 400 stations.`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('Seed error:', (err as Error).message);
    process.exit(1);
  });
}

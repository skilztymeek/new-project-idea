/**
 * Tests for seed-stations.ts
 *
 * Covers:
 *  1. CSV parsing logic with a small fixture
 *  2. Borough inference logic
 *  3. Idempotency of the upsert logic (mock DB)
 */

import {
  parseStopsCsv,
  filterParentStations,
  inferBorough,
  mapStopToStation,
  upsertStations,
  getLinesForStation,
  type GtfsStop,
  type StationRow,
} from './seed-stations';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FIXTURE_CSV = `stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
101,Van Cortlandt Park-242 St,40.889248,-73.898583,1,
102,238 St,40.884667,-73.90087,1,
103,231 St,40.878856,-73.904834,1,
104N,231 St,40.878856,-73.904834,0,103
104S,231 St,40.878856,-73.904834,0,103
201,Wakefield-241 St,40.903125,-73.850708,1,
301,Atlantic Av-Barclays Ctr,40.684359,-73.977666,1,
401,Times Sq-42 St,40.755477,-73.987691,1,
501,St George,40.643748,-74.073643,1,
A27,Howard Beach-JFK Airport,40.660476,-73.830301,1,
`;

// ---------------------------------------------------------------------------
// 1. CSV parsing
// ---------------------------------------------------------------------------

describe('parseStopsCsv', () => {
  it('parses all rows from the fixture CSV', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    expect(stops).toHaveLength(10);
  });

  it('maps fields correctly for the first row', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    const first = stops[0];
    expect(first).toBeDefined();
    expect(first!.stop_id).toBe('101');
    expect(first!.stop_name).toBe('Van Cortlandt Park-242 St');
    expect(first!.stop_lat).toBe('40.889248');
    expect(first!.stop_lon).toBe('-73.898583');
    expect(first!.location_type).toBe('1');
    expect(first!.parent_station).toBe('');
  });

  it('handles rows with empty parent_station', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    const parentStops = stops.filter((s) => s.location_type === '1');
    parentStops.forEach((s) => {
      expect(s.parent_station).toBe('');
    });
  });

  it('handles child stops with a parent_station reference', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    const childStops = stops.filter((s) => s.location_type === '0');
    expect(childStops.length).toBeGreaterThan(0);
    childStops.forEach((s) => {
      expect(s.parent_station).not.toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. filterParentStations
// ---------------------------------------------------------------------------

describe('filterParentStations', () => {
  it('returns only location_type=1 stops when present', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    const parents = filterParentStations(stops);
    expect(parents.every((s) => s.location_type === '1')).toBe(true);
  });

  it('excludes child stops (location_type=0)', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    const parents = filterParentStations(stops);
    expect(parents.some((s) => s.location_type === '0')).toBe(false);
  });

  it('returns 8 parent stations from the fixture (10 rows, 2 are children)', () => {
    const stops = parseStopsCsv(FIXTURE_CSV);
    const parents = filterParentStations(stops);
    // 10 rows total, 2 are child stops (104N, 104S)
    expect(parents).toHaveLength(8);
  });

  it('falls back to stops without parent_station when no location_type=1 rows exist', () => {
    const noTypeStops: GtfsStop[] = [
      { stop_id: '101', stop_name: 'Station A', stop_lat: '40.7', stop_lon: '-74.0', location_type: '', parent_station: '' },
      { stop_id: '101N', stop_name: 'Station A North', stop_lat: '40.7', stop_lon: '-74.0', location_type: '', parent_station: '101' },
      { stop_id: '102', stop_name: 'Station B', stop_lat: '40.8', stop_lon: '-74.1', location_type: '', parent_station: '' },
    ];
    const parents = filterParentStations(noTypeStops);
    // Should return stops without parent_station and without N/S suffix
    expect(parents.map((s) => s.stop_id)).toContain('101');
    expect(parents.map((s) => s.stop_id)).toContain('102');
    expect(parents.map((s) => s.stop_id)).not.toContain('101N');
  });
});

// ---------------------------------------------------------------------------
// 3. Borough inference
// ---------------------------------------------------------------------------

describe('inferBorough', () => {
  it('infers Manhattan for 1xx stop IDs', () => {
    expect(inferBorough('101')).toBe('Manhattan');
    expect(inferBorough('127')).toBe('Manhattan');
    expect(inferBorough('199')).toBe('Manhattan');
  });

  it('infers Bronx for 2xx stop IDs', () => {
    expect(inferBorough('201')).toBe('Bronx');
    expect(inferBorough('250')).toBe('Bronx');
  });

  it('infers Brooklyn for 3xx stop IDs', () => {
    expect(inferBorough('301')).toBe('Brooklyn');
    expect(inferBorough('399')).toBe('Brooklyn');
  });

  it('infers Queens for 4xx stop IDs', () => {
    expect(inferBorough('401')).toBe('Queens');
    expect(inferBorough('450')).toBe('Queens');
  });

  it('infers Staten Island for 5xx stop IDs', () => {
    expect(inferBorough('501')).toBe('Staten Island');
    expect(inferBorough('550')).toBe('Staten Island');
  });

  it('strips trailing N/S suffix before inferring borough', () => {
    expect(inferBorough('101N')).toBe('Manhattan');
    expect(inferBorough('301S')).toBe('Brooklyn');
    expect(inferBorough('201N')).toBe('Bronx');
  });

  it('handles letter-prefixed stop IDs with a reasonable default', () => {
    // Letter-prefixed IDs should return a valid borough string
    const validBoroughs = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
    expect(validBoroughs).toContain(inferBorough('A27'));
    expect(validBoroughs).toContain(inferBorough('R20'));
    expect(validBoroughs).toContain(inferBorough('G22'));
  });
});

// ---------------------------------------------------------------------------
// 4. mapStopToStation
// ---------------------------------------------------------------------------

describe('mapStopToStation', () => {
  it('maps a GtfsStop to a StationRow correctly', () => {
    const stop: GtfsStop = {
      stop_id: '127',
      stop_name: 'Times Sq-42 St',
      stop_lat: '40.755477',
      stop_lon: '-73.987691',
      location_type: '1',
      parent_station: '',
    };
    const row = mapStopToStation(stop);
    expect(row.id).toBe('127');
    expect(row.name).toBe('Times Sq-42 St');
    expect(row.borough).toBe('Manhattan');
    expect(row.lat).toBeCloseTo(40.755477);
    expect(row.lng).toBeCloseTo(-73.987691);
    expect(row.ada_accessible).toBe(false);
    expect(row.primary_scene_id).toBe('');
    expect(row.download_size_bytes).toBe(0);
  });

  it('includes lines from the hardcoded map when available', () => {
    const stop: GtfsStop = {
      stop_id: '127',
      stop_name: 'Times Sq-42 St',
      stop_lat: '40.755477',
      stop_lon: '-73.987691',
      location_type: '1',
      parent_station: '',
    };
    const row = mapStopToStation(stop);
    expect(row.lines).toEqual(['1', '2', '3']);
  });

  it('returns empty lines array for unknown stop IDs', () => {
    const stop: GtfsStop = {
      stop_id: '999',
      stop_name: 'Unknown Station',
      stop_lat: '40.7',
      stop_lon: '-74.0',
      location_type: '1',
      parent_station: '',
    };
    const row = mapStopToStation(stop);
    expect(row.lines).toEqual([]);
  });

  it('handles invalid lat/lon gracefully (defaults to 0)', () => {
    const stop: GtfsStop = {
      stop_id: '101',
      stop_name: 'Test',
      stop_lat: '',
      stop_lon: 'invalid',
      location_type: '1',
      parent_station: '',
    };
    const row = mapStopToStation(stop);
    expect(row.lat).toBe(0);
    expect(row.lng).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. getLinesForStation
// ---------------------------------------------------------------------------

describe('getLinesForStation', () => {
  it('returns lines for known station IDs', () => {
    expect(getLinesForStation('127')).toEqual(['1', '2', '3']);
    expect(getLinesForStation('132')).toEqual(['4', '5', '6']);
  });

  it('returns empty array for unknown station IDs', () => {
    expect(getLinesForStation('999')).toEqual([]);
    expect(getLinesForStation('XYZ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. upsertStations — idempotency with mocked DB
// ---------------------------------------------------------------------------

describe('upsertStations', () => {
  function makeMockClient(): { client: Client; queries: Array<{ text: string; values: unknown[] }> } {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: jest.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Client;
    return { client, queries };
  }

  const sampleStations: StationRow[] = [
    {
      id: '101',
      name: 'Van Cortlandt Park-242 St',
      borough: 'Manhattan',
      lines: ['1'],
      lat: 40.889248,
      lng: -73.898583,
      ada_accessible: false,
      primary_scene_id: '',
      download_size_bytes: 0,
    },
    {
      id: '201',
      name: 'Wakefield-241 St',
      borough: 'Bronx',
      lines: ['2'],
      lat: 40.903125,
      lng: -73.850708,
      ada_accessible: false,
      primary_scene_id: '',
      download_size_bytes: 0,
    },
  ];

  it('calls query once per station', async () => {
    const { client, queries } = makeMockClient();
    await upsertStations(client, sampleStations);
    expect(queries).toHaveLength(sampleStations.length);
  });

  it('returns the count of upserted stations', async () => {
    const { client } = makeMockClient();
    const count = await upsertStations(client, sampleStations);
    expect(count).toBe(sampleStations.length);
  });

  it('uses INSERT … ON CONFLICT … DO UPDATE (idempotent SQL)', async () => {
    const { client, queries } = makeMockClient();
    await upsertStations(client, sampleStations);
    queries.forEach((q) => {
      expect(q.text).toMatch(/ON CONFLICT \(id\) DO UPDATE/i);
    });
  });

  it('passes correct parameter values to the query', async () => {
    const { client, queries } = makeMockClient();
    await upsertStations(client, [sampleStations[0]!]);
    const q = queries[0]!;
    expect(q.values[0]).toBe('101');
    expect(q.values[1]).toBe('Van Cortlandt Park-242 St');
    expect(q.values[2]).toBe('Manhattan');
    expect(q.values[3]).toEqual(['1']);
    expect(q.values[4]).toBeCloseTo(40.889248);
    expect(q.values[5]).toBeCloseTo(-73.898583);
    expect(q.values[6]).toBe(false);
    expect(q.values[7]).toBe('');
    expect(q.values[8]).toBe(0);
  });

  it('is idempotent: calling twice produces the same number of queries', async () => {
    const { client, queries } = makeMockClient();
    await upsertStations(client, sampleStations);
    const firstRunCount = queries.length;
    await upsertStations(client, sampleStations);
    const secondRunCount = queries.length - firstRunCount;
    expect(secondRunCount).toBe(firstRunCount);
  });

  it('handles an empty stations array without error', async () => {
    const { client } = makeMockClient();
    const count = await upsertStations(client, []);
    expect(count).toBe(0);
  });
});

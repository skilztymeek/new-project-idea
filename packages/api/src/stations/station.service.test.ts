/**
 * Unit tests for station.service.ts
 *
 * All tests use a mocked pg Pool — no real database connection required.
 *
 * Covers:
 *  - listStations: correct page/pageSize slicing and total count
 *  - searchStations: matching query returns stations
 *  - searchStations: no results returns empty array + suggestions
 *  - getStationById: returns station with scenes and hotspots
 *  - getStationById: unknown id throws StationNotFoundError
 *  - getSceneById: returns scene with hotspots
 *  - getSceneById: unknown station id throws StationNotFoundError
 *  - getSceneById: unknown scene id throws SceneNotFoundError
 */

import {
  listStations,
  searchStations,
  getStationById,
  getSceneById,
  StationNotFoundError,
  SceneNotFoundError,
} from './station.service';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Helpers — build minimal DB row fixtures
// ---------------------------------------------------------------------------

function makeDbStation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'station-1',
    name: 'Times Sq-42 St',
    borough: 'Manhattan',
    lines: ['1', '2', '3', 'N', 'Q', 'R'],
    lat: 40.7549,
    lng: -73.9874,
    ada_accessible: true,
    opening_year: 1904,
    notable_features: 'Busiest station in the system',
    primary_scene_id: 'scene-1',
    download_size_bytes: '1048576',
    ...overrides,
  };
}

function makeDbScene(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'scene-1',
    station_id: 'station-1',
    area_label: 'Northbound Platform',
    panorama_url: 'https://cdn.example.com/scenes/scene-1.jpg',
    thumbnail_url: 'https://cdn.example.com/scenes/scene-1-thumb.jpg',
    minimap_position_x: 0.5,
    minimap_position_y: 0.3,
    captured_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function makeDbHotspot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'hotspot-1',
    scene_id: 'scene-1',
    linked_scene_id: 'scene-2',
    yaw: 45.0,
    pitch: -10.0,
    label: '→ Southbound Platform',
    type: 'navigation',
    info_content: null,
    ...overrides,
  };
}

/**
 * Creates a mock Pool whose query() method returns different results
 * based on call order (using a queue of responses).
 */
function makeMockPool(responses: Array<{ rows: unknown[] }>): Pool {
  const queue = [...responses];
  return {
    query: jest.fn().mockImplementation(() => {
      const next = queue.shift();
      if (!next) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve(next);
    }),
  } as unknown as Pool;
}

// ---------------------------------------------------------------------------
// listStations
// ---------------------------------------------------------------------------

describe('listStations', () => {
  test('returns stations with correct page and pageSize', async () => {
    const dbStation = makeDbStation();
    const pool = makeMockPool([
      { rows: [dbStation] },          // SELECT rows
      { rows: [{ count: '42' }] },    // COUNT(*)
    ]);

    const result = await listStations(pool, 1, 20);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(42);
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]!.id).toBe('station-1');
    expect(result.stations[0]!.name).toBe('Times Sq-42 St');
  });

  test('maps DB row fields to Station interface correctly', async () => {
    const dbStation = makeDbStation();
    const pool = makeMockPool([
      { rows: [dbStation] },
      { rows: [{ count: '1' }] },
    ]);

    const result = await listStations(pool, 1, 20);
    const station = result.stations[0]!;

    expect(station.borough).toBe('Manhattan');
    expect(station.lines).toEqual(['1', '2', '3', 'N', 'Q', 'R']);
    expect(station.coordinates).toEqual({ lat: 40.7549, lng: -73.9874 });
    expect(station.adaAccessible).toBe(true);
    expect(station.openingYear).toBe(1904);
    expect(station.downloadSizeBytes).toBe(1048576);
    expect(station.scenes).toEqual([]);
  });

  test('returns empty stations array when no rows', async () => {
    const pool = makeMockPool([
      { rows: [] },
      { rows: [{ count: '0' }] },
    ]);

    const result = await listStations(pool, 1, 20);

    expect(result.stations).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test('passes correct page and pageSize to query (page 2, size 10)', async () => {
    const pool = makeMockPool([
      { rows: [] },
      { rows: [{ count: '100' }] },
    ]);

    const result = await listStations(pool, 2, 10);

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    // Verify offset was calculated: (2-1)*10 = 10
    const queryMock = pool.query as jest.Mock;
    const firstCall = queryMock.mock.calls[0];
    expect(firstCall[1]).toEqual([10, 10]); // [pageSize, offset]
  });

  test('returns multiple stations', async () => {
    const station1 = makeDbStation({ id: 'station-1', name: 'Times Sq-42 St' });
    const station2 = makeDbStation({ id: 'station-2', name: 'Grand Central-42 St' });
    const pool = makeMockPool([
      { rows: [station1, station2] },
      { rows: [{ count: '2' }] },
    ]);

    const result = await listStations(pool, 1, 20);

    expect(result.stations).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// searchStations
// ---------------------------------------------------------------------------

describe('searchStations', () => {
  test('returns matching stations when results found', async () => {
    const dbStation = makeDbStation();
    const pool = makeMockPool([{ rows: [dbStation] }]);

    const result = await searchStations(pool, 'Times');

    expect(result.stations).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.suggestions).toBeUndefined();
    expect(result.stations[0]!.name).toBe('Times Sq-42 St');
  });

  test('returns empty array and suggestions when no results found', async () => {
    const popularStation = makeDbStation({ id: 'popular-1', name: 'Grand Central' });
    // First query: search returns no results; second query: suggestions
    const pool = makeMockPool([
      { rows: [] },           // search query
      { rows: [popularStation] }, // suggestions query
    ]);

    const result = await searchStations(pool, 'xyznonexistent');

    expect(result.stations).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions![0]!.name).toBe('Grand Central');
  });

  test('returns nearby suggestions when lat/lng provided and no results', async () => {
    const nearbyStation = makeDbStation({ id: 'nearby-1', name: 'Nearby Station' });
    const pool = makeMockPool([
      { rows: [] },
      { rows: [nearbyStation] },
    ]);

    const result = await searchStations(pool, 'xyznonexistent', undefined, undefined, 40.75, -73.99);

    expect(result.stations).toHaveLength(0);
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions![0]!.name).toBe('Nearby Station');

    // Verify the suggestions query used lat/lng params
    const queryMock = pool.query as jest.Mock;
    const secondCall = queryMock.mock.calls[1];
    expect(secondCall[1]).toEqual([40.75, -73.99]);
  });

  test('returns empty suggestions array when no results and no popular stations', async () => {
    const pool = makeMockPool([
      { rows: [] },
      { rows: [] },
    ]);

    const result = await searchStations(pool, 'xyznonexistent');

    expect(result.stations).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.suggestions).toEqual([]);
  });

  test('applies borough filter', async () => {
    const dbStation = makeDbStation({ borough: 'Brooklyn' });
    const pool = makeMockPool([{ rows: [dbStation] }]);

    const result = await searchStations(pool, '', 'Brooklyn');

    expect(result.stations).toHaveLength(1);
    // Verify borough was passed as a query param
    const queryMock = pool.query as jest.Mock;
    const firstCall = queryMock.mock.calls[0];
    expect(firstCall[1]).toContain('Brooklyn');
  });

  test('applies line filter', async () => {
    const dbStation = makeDbStation({ lines: ['A', 'C', 'E'] });
    const pool = makeMockPool([{ rows: [dbStation] }]);

    const result = await searchStations(pool, '', undefined, 'A');

    expect(result.stations).toHaveLength(1);
    const queryMock = pool.query as jest.Mock;
    const firstCall = queryMock.mock.calls[0];
    expect(firstCall[1]).toContain('A');
  });

  test('returns multiple matching stations', async () => {
    const s1 = makeDbStation({ id: 's1', name: 'Station Alpha' });
    const s2 = makeDbStation({ id: 's2', name: 'Station Beta' });
    const pool = makeMockPool([{ rows: [s1, s2] }]);

    const result = await searchStations(pool, 'Station');

    expect(result.stations).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getStationById
// ---------------------------------------------------------------------------

describe('getStationById', () => {
  test('returns station with scenes and hotspots', async () => {
    const dbStation = makeDbStation();
    const dbScene = makeDbScene();
    const dbHotspot = makeDbHotspot();

    const pool = makeMockPool([
      { rows: [dbStation] },   // station query
      { rows: [dbScene] },     // scenes query
      { rows: [dbHotspot] },   // hotspots query
    ]);

    const station = await getStationById(pool, 'station-1');

    expect(station.id).toBe('station-1');
    expect(station.name).toBe('Times Sq-42 St');
    expect(station.scenes).toHaveLength(1);

    const scene = station.scenes[0]!;
    expect(scene.id).toBe('scene-1');
    expect(scene.areaLabel).toBe('Northbound Platform');
    expect(scene.hotspots).toHaveLength(1);

    const hotspot = scene.hotspots[0]!;
    expect(hotspot.id).toBe('hotspot-1');
    expect(hotspot.linkedSceneId).toBe('scene-2');
    expect(hotspot.yaw).toBe(45.0);
    expect(hotspot.pitch).toBe(-10.0);
    expect(hotspot.label).toBe('→ Southbound Platform');
    expect(hotspot.type).toBe('navigation');
  });

  test('returns station with empty scenes when no scenes exist', async () => {
    const dbStation = makeDbStation();
    const pool = makeMockPool([
      { rows: [dbStation] },
      { rows: [] },  // no scenes
      // hotspots query won't be called since sceneIds is empty
    ]);

    const station = await getStationById(pool, 'station-1');

    expect(station.scenes).toHaveLength(0);
  });

  test('throws StationNotFoundError for unknown station id', async () => {
    const pool = makeMockPool([{ rows: [] }]);

    await expect(getStationById(pool, 'nonexistent-id')).rejects.toThrow(
      StationNotFoundError,
    );
  });

  test('StationNotFoundError message contains the station id', async () => {
    const pool = makeMockPool([{ rows: [] }]);

    await expect(getStationById(pool, 'bad-id')).rejects.toThrow('bad-id');
  });

  test('maps info hotspot with infoContent', async () => {
    const dbStation = makeDbStation();
    const dbScene = makeDbScene();
    const dbHotspot = makeDbHotspot({
      type: 'info',
      info_content: 'This is the main entrance',
    });

    const pool = makeMockPool([
      { rows: [dbStation] },
      { rows: [dbScene] },
      { rows: [dbHotspot] },
    ]);

    const station = await getStationById(pool, 'station-1');
    const hotspot = station.scenes[0]!.hotspots[0]!;

    expect(hotspot.type).toBe('info');
    expect(hotspot.infoContent).toBe('This is the main entrance');
  });

  test('returns station with multiple scenes each having their own hotspots', async () => {
    const dbStation = makeDbStation();
    const dbScene1 = makeDbScene({ id: 'scene-1', area_label: 'Platform A' });
    const dbScene2 = makeDbScene({ id: 'scene-2', station_id: 'station-1', area_label: 'Platform B' });
    const dbHotspot1 = makeDbHotspot({ id: 'h1', scene_id: 'scene-1', linked_scene_id: 'scene-2' });
    const dbHotspot2 = makeDbHotspot({ id: 'h2', scene_id: 'scene-2', linked_scene_id: 'scene-1' });

    const pool = makeMockPool([
      { rows: [dbStation] },
      { rows: [dbScene1, dbScene2] },
      { rows: [dbHotspot1, dbHotspot2] },
    ]);

    const station = await getStationById(pool, 'station-1');

    expect(station.scenes).toHaveLength(2);
    expect(station.scenes[0]!.hotspots).toHaveLength(1);
    expect(station.scenes[1]!.hotspots).toHaveLength(1);
    expect(station.scenes[0]!.hotspots[0]!.id).toBe('h1');
    expect(station.scenes[1]!.hotspots[0]!.id).toBe('h2');
  });
});

// ---------------------------------------------------------------------------
// getSceneById
// ---------------------------------------------------------------------------

describe('getSceneById', () => {
  test('returns scene with hotspots', async () => {
    const dbScene = makeDbScene();
    const dbHotspot = makeDbHotspot();

    const pool = makeMockPool([
      { rows: [{ id: 'station-1' }] }, // station existence check
      { rows: [dbScene] },              // scene query
      { rows: [dbHotspot] },            // hotspots query
    ]);

    const scene = await getSceneById(pool, 'station-1', 'scene-1');

    expect(scene.id).toBe('scene-1');
    expect(scene.stationId).toBe('station-1');
    expect(scene.areaLabel).toBe('Northbound Platform');
    expect(scene.panoramaUrl).toBe('https://cdn.example.com/scenes/scene-1.jpg');
    expect(scene.minimapPosition).toEqual({ x: 0.5, y: 0.3 });
    expect(scene.hotspots).toHaveLength(1);
    expect(scene.hotspots[0]!.id).toBe('hotspot-1');
  });

  test('returns scene with empty hotspots when none exist', async () => {
    const dbScene = makeDbScene();

    const pool = makeMockPool([
      { rows: [{ id: 'station-1' }] },
      { rows: [dbScene] },
      { rows: [] },
    ]);

    const scene = await getSceneById(pool, 'station-1', 'scene-1');

    expect(scene.hotspots).toHaveLength(0);
  });

  test('throws StationNotFoundError for unknown station id', async () => {
    const pool = makeMockPool([{ rows: [] }]);

    await expect(
      getSceneById(pool, 'nonexistent-station', 'scene-1'),
    ).rejects.toThrow(StationNotFoundError);
  });

  test('throws SceneNotFoundError for unknown scene id', async () => {
    const pool = makeMockPool([
      { rows: [{ id: 'station-1' }] }, // station exists
      { rows: [] },                     // scene not found
    ]);

    await expect(
      getSceneById(pool, 'station-1', 'nonexistent-scene'),
    ).rejects.toThrow(SceneNotFoundError);
  });

  test('throws SceneNotFoundError when scene belongs to different station', async () => {
    const pool = makeMockPool([
      { rows: [{ id: 'station-1' }] },
      { rows: [] }, // scene not found for this station
    ]);

    await expect(
      getSceneById(pool, 'station-1', 'scene-from-other-station'),
    ).rejects.toThrow(SceneNotFoundError);
  });

  test('SceneNotFoundError message contains scene and station ids', async () => {
    const pool = makeMockPool([
      { rows: [{ id: 'station-1' }] },
      { rows: [] },
    ]);

    await expect(
      getSceneById(pool, 'station-1', 'bad-scene'),
    ).rejects.toThrow(/bad-scene/);
  });

  test('maps capturedAt from DB row', async () => {
    const dbScene = makeDbScene({ captured_at: '2024-06-01T12:00:00Z' });

    const pool = makeMockPool([
      { rows: [{ id: 'station-1' }] },
      { rows: [dbScene] },
      { rows: [] },
    ]);

    const scene = await getSceneById(pool, 'station-1', 'scene-1');

    expect(scene.capturedAt).toBe('2024-06-01T12:00:00Z');
  });
});

/**
 * Smoke tests for shared type definitions.
 * Verifies that the types are correctly exported and that fast-check
 * is properly configured for property-based testing in this package.
 */

import * as fc from 'fast-check';
import type {
  Station,
  Scene,
  Hotspot,
  User,
  Favorite,
  HistoryEntry,
  DownloadManifest,
} from './types';

// ---------------------------------------------------------------------------
// Type construction smoke tests
// ---------------------------------------------------------------------------

describe('Shared type definitions', () => {
  it('constructs a valid Station object', () => {
    const station: Station = {
      id: '101',
      name: 'Times Sq-42 St',
      borough: 'Manhattan',
      lines: ['1', '2', '3', '7', 'N', 'Q', 'R', 'W'],
      coordinates: { lat: 40.7549, lng: -73.9874 },
      adaAccessible: true,
      openingYear: 1904,
      notableFeatures: 'Busiest station in the NYC subway system',
      primarySceneId: 'scene-101-platform-1',
      scenes: [],
      downloadSizeBytes: 524288000,
    };
    expect(station.id).toBe('101');
    expect(station.borough).toBe('Manhattan');
    expect(station.lines).toHaveLength(8);
  });

  it('constructs a valid Scene object', () => {
    const scene: Scene = {
      id: 'scene-101-platform-1',
      stationId: '101',
      areaLabel: 'Northbound Platform',
      panoramaUrl: 'https://cdn.example.com/scenes/101/platform-1/panorama.jpg',
      thumbnailUrl: 'https://cdn.example.com/scenes/101/platform-1/thumb.jpg',
      hotspots: [],
      minimapPosition: { x: 0.5, y: 0.3 },
      capturedAt: '2024-01-15T10:30:00Z',
    };
    expect(scene.areaLabel).toBe('Northbound Platform');
    expect(scene.minimapPosition.x).toBe(0.5);
  });

  it('constructs a valid Hotspot object', () => {
    const hotspot: Hotspot = {
      id: 'hotspot-1',
      sceneId: 'scene-101-platform-1',
      linkedSceneId: 'scene-101-mezzanine',
      yaw: 45.0,
      pitch: -10.0,
      label: '→ Mezzanine',
      type: 'navigation',
    };
    expect(hotspot.type).toBe('navigation');
    expect(hotspot.yaw).toBe(45.0);
  });

  it('constructs a valid info Hotspot with infoContent', () => {
    const hotspot: Hotspot = {
      id: 'hotspot-info-1',
      sceneId: 'scene-101-platform-1',
      linkedSceneId: 'scene-101-platform-1',
      yaw: 90.0,
      pitch: 0.0,
      label: 'Historic Mosaic',
      type: 'info',
      infoContent: 'This mosaic was installed in 1904 during the original station construction.',
    };
    expect(hotspot.type).toBe('info');
    expect(hotspot.infoContent).toBeDefined();
  });

  it('constructs a valid User object (email/password)', () => {
    const user: User = {
      id: 'user-abc123',
      email: 'rider@example.com',
      passwordHash: '$2b$12$hashedpassword',
      oauthProvider: null,
      oauthSubject: null,
      tier: 'free',
      premiumExpiresAt: null,
      createdAt: '2024-06-01T00:00:00Z',
    };
    expect(user.tier).toBe('free');
    expect(user.oauthProvider).toBeNull();
  });

  it('constructs a valid User object (OAuth)', () => {
    const user: User = {
      id: 'user-oauth-456',
      email: 'rider@gmail.com',
      passwordHash: null,
      oauthProvider: 'google',
      oauthSubject: 'google-subject-id-789',
      tier: 'premium',
      premiumExpiresAt: '2025-06-01T00:00:00Z',
      createdAt: '2024-06-01T00:00:00Z',
    };
    expect(user.oauthProvider).toBe('google');
    expect(user.tier).toBe('premium');
  });

  it('constructs a valid Favorite object', () => {
    const favorite: Favorite = {
      userId: 'user-abc123',
      stationId: '101',
      createdAt: '2024-07-01T12:00:00Z',
    };
    expect(favorite.userId).toBe('user-abc123');
    expect(favorite.stationId).toBe('101');
  });

  it('constructs a valid HistoryEntry object', () => {
    const entry: HistoryEntry = {
      userId: 'user-abc123',
      stationId: '101',
      visitedAt: '2024-07-15T09:00:00Z',
    };
    expect(entry.visitedAt).toBe('2024-07-15T09:00:00Z');
  });

  it('constructs a valid DownloadManifest object', () => {
    const manifest: DownloadManifest = {
      stationId: '101',
      status: 'complete',
      totalBytes: 524288000,
      downloadedBytes: 524288000,
      localPath: '/data/user/0/com.example.app/files/stations/101',
      downloadedAt: '2024-07-20T14:00:00Z',
    };
    expect(manifest.status).toBe('complete');
    expect(manifest.downloadedBytes).toBe(manifest.totalBytes);
  });

  it('constructs a pending DownloadManifest with null downloadedAt', () => {
    const manifest: DownloadManifest = {
      stationId: '202',
      status: 'pending',
      totalBytes: 104857600,
      downloadedBytes: 0,
      localPath: '',
      downloadedAt: null,
    };
    expect(manifest.status).toBe('pending');
    expect(manifest.downloadedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fast-check integration smoke test
// ---------------------------------------------------------------------------

describe('fast-check integration', () => {
  it('is correctly installed and functional', () => {
    // Verify fast-check can generate and run a simple property
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        return (a + b).length === a.length + b.length;
      }),
      { numRuns: 100 },
    );
  });

  it('generates valid borough values', () => {
    const boroughs = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'] as const;
    const arbitraryBorough = fc.constantFrom(...boroughs);

    fc.assert(
      fc.property(arbitraryBorough, (borough) => {
        return boroughs.includes(borough);
      }),
      { numRuns: 100 },
    );
  });

  it('generates valid hotspot yaw values in [-180, 180]', () => {
    const arbitraryYaw = fc.float({ min: -180, max: 180, noNaN: true });

    fc.assert(
      fc.property(arbitraryYaw, (yaw) => {
        return yaw >= -180 && yaw <= 180;
      }),
      { numRuns: 100 },
    );
  });

  it('generates valid hotspot pitch values in [-90, 90]', () => {
    const arbitraryPitch = fc.float({ min: -90, max: 90, noNaN: true });

    fc.assert(
      fc.property(arbitraryPitch, (pitch) => {
        return pitch >= -90 && pitch <= 90;
      }),
      { numRuns: 100 },
    );
  });
});

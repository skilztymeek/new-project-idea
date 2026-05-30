/**
 * Shared TypeScript interfaces for the NYC Subway Virtual Tour.
 * These types are used across the mobile, web, and API packages.
 */

// ---------------------------------------------------------------------------
// Station & Scene
// ---------------------------------------------------------------------------

export interface Station {
  /** GTFS stop_id (e.g., "101") */
  id: string;
  /** e.g., "Times Sq-42 St" */
  name: string;
  borough: 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Staten Island';
  /** e.g., ["1", "2", "3", "7", "N", "Q", "R", "W"] */
  lines: string[];
  coordinates: { lat: number; lng: number };
  adaAccessible: boolean;
  openingYear: number | null;
  notableFeatures: string | null;
  primarySceneId: string;
  scenes: Scene[];
  /** Total size of the offline download package in bytes */
  downloadSizeBytes: number;
}

export interface Scene {
  id: string;
  stationId: string;
  /** e.g., "Northbound Platform", "Mezzanine" */
  areaLabel: string;
  /** CDN URL to equirectangular image or tile manifest */
  panoramaUrl: string;
  thumbnailUrl: string;
  hotspots: Hotspot[];
  /** Normalized [0, 1] coordinates on the station floor plan */
  minimapPosition: { x: number; y: number };
  /** ISO 8601 date string */
  capturedAt: string;
}

export interface Hotspot {
  id: string;
  sceneId: string;
  linkedSceneId: string;
  /** Degrees, -180 to 180 */
  yaw: number;
  /** Degrees, -90 to 90 */
  pitch: number;
  /** e.g., "→ Southbound Platform" */
  label: string;
  type: 'navigation' | 'info';
  /** Only present for info-type hotspots */
  infoContent?: string;
}

// ---------------------------------------------------------------------------
// User & Auth
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  /** null for OAuth-only accounts */
  passwordHash: string | null;
  oauthProvider: 'google' | 'apple' | null;
  oauthSubject: string | null;
  tier: 'free' | 'premium';
  /** ISO 8601 date string; null for free-tier users */
  premiumExpiresAt: string | null;
  /** ISO 8601 date string */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Favorites & History
// ---------------------------------------------------------------------------

export interface Favorite {
  userId: string;
  stationId: string;
  /** ISO 8601 date string */
  createdAt: string;
}

export interface HistoryEntry {
  userId: string;
  stationId: string;
  /** ISO 8601 date string; updated on re-visit (upsert) */
  visitedAt: string;
}

// ---------------------------------------------------------------------------
// Offline Download
// ---------------------------------------------------------------------------

export interface DownloadManifest {
  stationId: string;
  status: 'pending' | 'downloading' | 'complete' | 'error';
  totalBytes: number;
  downloadedBytes: number;
  localPath: string;
  /** ISO 8601 date string; null until download completes */
  downloadedAt: string | null;
}

/**
 * MTA Service — GTFS-Realtime feed fetching, protobuf parsing, and Redis caching.
 *
 * Responsibilities:
 *  - Fetch MTA GTFS-RT protobuf feed and parse arrival times for a given station
 *  - Cache arrivals in Redis with key `arrivals:{stationId}` TTL 30 seconds
 *  - Cache station metadata in Redis with key `station:{stationId}` TTL 24h
 *  - Return 503-compatible error when GTFS-RT feed is unreachable
 *  - Return stale cached data with `stale: true` and `lastUpdatedAt` when static feed is down
 *
 * Environment variables:
 *   MTA_API_KEY — API key for the MTA GTFS-RT feed (x-api-key header)
 */

import { transit_realtime } from 'gtfs-realtime-bindings';
import type Redis from 'ioredis';
import { Station } from '@nyc-subway-tour/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** MTA GTFS-Realtime feed URL (1/2/3/4/5/6/7/S lines) */
export const MTA_GTFS_RT_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs';

/** Redis TTL for arrivals cache (30 seconds) */
const ARRIVALS_CACHE_TTL_SECONDS = 30;

/** Redis TTL for station metadata cache (24 hours) */
const STATION_CACHE_TTL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArrivalTime {
  routeId: string;
  tripId: string;
  arrivalTime: number;   // Unix timestamp
  departureTime: number; // Unix timestamp
  stopSequence: number;
}

export interface ArrivalsResponse {
  stationId: string;
  arrivals: ArrivalTime[];
  cachedAt: string; // ISO 8601
  stale?: boolean;
}

export interface StationCacheEntry {
  station: Station;
  cachedAt: string; // ISO 8601
}

export interface StaleStationResult {
  station: Station;
  stale: true;
  lastUpdatedAt: string; // ISO 8601
}

/** Error thrown when the MTA GTFS-RT feed is unreachable */
export class MtaFeedUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Live arrivals temporarily unavailable.');
    this.name = 'MtaFeedUnavailableError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Arrivals (Task 4.3)
// ---------------------------------------------------------------------------

/**
 * Fetches real-time arrivals for a station from the MTA GTFS-RT feed.
 *
 * Cache strategy:
 *  1. Check Redis for `arrivals:{stationId}` — return cached result if present.
 *  2. Fetch MTA GTFS-RT protobuf feed.
 *  3. Parse and filter stop time updates for the given stationId.
 *  4. Store result in Redis with TTL 30s.
 *
 * @throws MtaFeedUnavailableError when the feed cannot be reached or parsed.
 */
export async function getArrivals(
  stationId: string,
  redis: Redis,
  fetchFn: typeof fetch = fetch,
): Promise<ArrivalsResponse> {
  const cacheKey = `arrivals:${stationId}`;

  // 1. Check cache
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached) as ArrivalsResponse;
  }

  // 2. Fetch from MTA
  const apiKey = process.env['MTA_API_KEY'] ?? '';
  let feedBuffer: ArrayBuffer;

  try {
    const response = await fetchFn(MTA_GTFS_RT_URL, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      throw new Error(`MTA feed responded with HTTP ${response.status}`);
    }

    feedBuffer = await response.arrayBuffer();
  } catch (err) {
    throw new MtaFeedUnavailableError(err);
  }

  // 3. Parse protobuf
  let arrivals: ArrivalTime[];
  try {
    arrivals = parseFeedForStation(new Uint8Array(feedBuffer), stationId);
  } catch (err) {
    throw new MtaFeedUnavailableError(err);
  }

  // 4. Cache and return
  const result: ArrivalsResponse = {
    stationId,
    arrivals,
    cachedAt: new Date().toISOString(),
  };

  await redis.set(cacheKey, JSON.stringify(result), 'EX', ARRIVALS_CACHE_TTL_SECONDS);

  return result;
}

/**
 * Parses a GTFS-RT protobuf buffer and extracts arrival/departure times
 * for stop IDs that match the given stationId.
 *
 * MTA stop IDs use the pattern `{stationId}N` (northbound) and `{stationId}S`
 * (southbound), so we match any stopId that starts with the stationId.
 */
export function parseFeedForStation(
  buffer: Uint8Array,
  stationId: string,
): ArrivalTime[] {
  const feed = transit_realtime.FeedMessage.decode(buffer);
  const arrivals: ArrivalTime[] = [];

  for (const entity of feed.entity) {
    if (!entity.tripUpdate) continue;

    const { trip, stopTimeUpdate } = entity.tripUpdate;
    const routeId = trip?.routeId ?? '';
    const tripId = trip?.tripId ?? '';

    for (const stu of stopTimeUpdate ?? []) {
      const stopId = stu.stopId ?? '';
      // Match exact stationId or directional variants (e.g., "101N", "101S")
      if (stopId !== stationId && !stopId.startsWith(`${stationId}N`) && !stopId.startsWith(`${stationId}S`)) {
        continue;
      }

      const arrivalTime = toUnixTimestamp(stu.arrival?.time);
      const departureTime = toUnixTimestamp(stu.departure?.time);
      const stopSequence = stu.stopSequence ?? 0;

      arrivals.push({ routeId, tripId, arrivalTime, departureTime, stopSequence });
    }
  }

  return arrivals;
}

/**
 * Converts a protobuf Long or number timestamp to a plain JS number (Unix seconds).
 * Returns 0 if the value is null/undefined.
 */
function toUnixTimestamp(value: number | { toNumber(): number } | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  // Long type from protobufjs
  return value.toNumber();
}

// ---------------------------------------------------------------------------
// Station metadata caching (Task 4.4)
// ---------------------------------------------------------------------------

/**
 * Caches station metadata in Redis with a 24-hour TTL.
 *
 * @param station - The station object to cache.
 * @param redis   - The Redis client.
 */
export async function cacheStationMetadata(
  station: Station,
  redis: Redis,
): Promise<void> {
  const cacheKey = `station:${station.id}`;
  const entry: StationCacheEntry = {
    station,
    cachedAt: new Date().toISOString(),
  };
  await redis.set(cacheKey, JSON.stringify(entry), 'EX', STATION_CACHE_TTL_SECONDS);
}

/**
 * Retrieves station metadata from Redis cache.
 *
 * Returns the cached station with `stale: true` and `lastUpdatedAt` when the
 * live feed is unavailable and only cached data is available.
 *
 * @returns The cached station entry, or null if the cache is cold.
 */
export async function getCachedStationMetadata(
  stationId: string,
  redis: Redis,
): Promise<StaleStationResult | null> {
  const cacheKey = `station:${stationId}`;
  const cached = await redis.get(cacheKey);

  if (cached === null) return null;

  const entry = JSON.parse(cached) as StationCacheEntry;
  return {
    station: entry.station,
    stale: true,
    lastUpdatedAt: entry.cachedAt,
  };
}

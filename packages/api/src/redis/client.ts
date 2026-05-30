/**
 * Redis client singleton using ioredis.
 *
 * Environment variables:
 *   REDIS_URL — Redis connection string (default: redis://localhost:6379)
 */

import Redis from 'ioredis';

let redisClient: Redis | null = null;

/**
 * Returns the shared Redis client instance, creating it on first call.
 */
export function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redisClient = new Redis(url, {
      // Disable auto-reconnect in test environments to avoid hanging
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return redisClient;
}

/**
 * Closes the Redis connection. Useful for graceful shutdown and tests.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

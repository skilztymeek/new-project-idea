/**
 * Station Router — Express router for station index and search endpoints.
 *
 * Endpoints (all public, no auth required):
 *   GET /stations                          — paginated station list
 *   GET /stations/search?q=&borough=&line= — full-text search with suggestions
 *   GET /stations/:id                      — station detail with scene list
 *   GET /stations/:id/scenes/:sceneId      — scene metadata with hotspots
 */

import { Router, Request, Response } from 'express';
import { getPool } from '../db/client';
import {
  listStations,
  searchStations,
  getStationById,
  getSceneById,
  StationNotFoundError,
  SceneNotFoundError,
} from './station.service';

/** Maximum allowed pageSize to prevent abuse */
const MAX_PAGE_SIZE = 100;
/** Default page size for paginated list */
const DEFAULT_PAGE_SIZE = 20;

export function createStationRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /stations/search  (must be registered before /:id to avoid conflict)
  // -------------------------------------------------------------------------
  router.get('/search', async (req: Request, res: Response) => {
    const { q, borough, line, lat, lng } = req.query as Record<string, string | undefined>;

    const latNum = lat !== undefined ? parseFloat(lat) : undefined;
    const lngNum = lng !== undefined ? parseFloat(lng) : undefined;

    // Validate lat/lng if provided
    if (lat !== undefined && (isNaN(latNum!) || latNum! < -90 || latNum! > 90)) {
      res.status(400).json({ error: 'Invalid lat parameter.' });
      return;
    }
    if (lng !== undefined && (isNaN(lngNum!) || lngNum! < -180 || lngNum! > 180)) {
      res.status(400).json({ error: 'Invalid lng parameter.' });
      return;
    }

    try {
      const pool = getPool();
      const result = await searchStations(pool, q ?? '', borough, line, latNum, lngNum);
      res.status(200).json(result);
    } catch (err) {
      console.error('Search stations error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /stations
  // -------------------------------------------------------------------------
  router.get('/', async (req: Request, res: Response) => {
    const rawPage = req.query['page'];
    const rawPageSize = req.query['pageSize'];

    const page = rawPage !== undefined ? parseInt(String(rawPage), 10) : 1;
    const pageSize =
      rawPageSize !== undefined
        ? parseInt(String(rawPageSize), 10)
        : DEFAULT_PAGE_SIZE;

    if (isNaN(page) || page < 1) {
      res.status(400).json({ error: 'page must be a positive integer.' });
      return;
    }
    if (isNaN(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      res
        .status(400)
        .json({ error: `pageSize must be between 1 and ${MAX_PAGE_SIZE}.` });
      return;
    }

    try {
      const pool = getPool();
      const result = await listStations(pool, page, pageSize);
      res.status(200).json(result);
    } catch (err) {
      console.error('List stations error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /stations/:id/scenes/:sceneId
  // -------------------------------------------------------------------------
  router.get('/:id/scenes/:sceneId', async (req: Request, res: Response) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };

    try {
      const pool = getPool();
      const scene = await getSceneById(pool, id, sceneId);
      res.status(200).json(scene);
    } catch (err) {
      if (err instanceof StationNotFoundError) {
        res.status(404).json({ error: err.message });
      } else if (err instanceof SceneNotFoundError) {
        res.status(404).json({ error: err.message });
      } else {
        console.error('Get scene error:', err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  });

  // -------------------------------------------------------------------------
  // GET /stations/:id
  // -------------------------------------------------------------------------
  router.get('/:id', async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    try {
      const pool = getPool();
      const station = await getStationById(pool, id);
      res.status(200).json(station);
    } catch (err) {
      if (err instanceof StationNotFoundError) {
        res.status(404).json({ error: err.message });
      } else {
        console.error('Get station error:', err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  });

  return router;
}

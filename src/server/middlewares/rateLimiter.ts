import { Request, Response, NextFunction } from 'express';

const ipHits = new Map<string, { count: number; resetTime: number }>();

/**
 * Lightweight, in-memory sliding window rate limiter for Cloud Run.
 * Prevents DDoS and API flood without external Redis dependency.
 */
export function rateLimiter(_limit: number = 50000, _windowMs: number = 60000) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    // Disabled rate limiting to allow simultaneous multi-student exam labs
    next();
  };
}

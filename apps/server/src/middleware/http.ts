import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { ZodError, type ZodType, type z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/** Wrap async handlers so rejections reach the error handler. */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function body<T extends ZodType>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.body ?? {});
}
export function query<T extends ZodType>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.query ?? {});
}

/** Reject cross-site state-changing requests (defence in depth alongside SameSite + CSRF token). */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin non-browser clients (tests, curl) — still need CSRF token when authenticated
  // APP_ORIGIN may list several origins, comma-separated (e.g. local dev + a temporary public tunnel URL)
  const allowed = new Set([...env.APP_ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, '')), `http://localhost:${env.PORT}`, `http://127.0.0.1:${env.PORT}`]);
  // Same-origin: the page and the API are served from the same host (built frontend served by this server).
  let sameHost = false;
  try {
    sameHost = new URL(origin).host === req.headers.host;
  } catch {
    sameHost = false;
  }
  if (!allowed.has(origin) && !sameHost) return next(new AppError(403, 'BAD_ORIGIN', 'Cross-origin request rejected'));
  next();
}

const isTest = env.NODE_ENV === 'test';
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: isTest ? 10_000 : 300, standardHeaders: 'draft-7', legacyHeaders: false });
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 10_000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
});
export const sensitiveLimiter = rateLimit({ windowMs: 60_000, limit: isTest ? 10_000 : 20, standardHeaders: 'draft-7', legacyHeaders: false });

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', details: err.issues },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This record already exists (duplicate prevented)' } });
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}

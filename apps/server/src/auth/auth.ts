import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError, forbidden } from '../lib/errors.js';
import { isAdminRole } from '../lib/constants.js';

export const SESSION_COOKIE = 'es_session';
export const CSRF_COOKIE = 'es_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (hashStr: string, pw: string) => verify(hashStr, pw).catch(() => false);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  sessionId: string;
  csrfToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const cookieBase = () => ({
  sameSite: 'strict' as const,
  secure: env.NODE_ENV === 'production',
  path: '/',
});

export async function createSession(res: Response, req: Request, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  await prisma.session.create({
    data: {
      id: sha256(token),
      userId,
      csrfToken,
      ip: req.ip ?? null,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      expiresAt,
    },
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), httpOnly: true, expires: expiresAt });
  // CSRF double-submit token: readable by our JS, sent back in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE, csrfToken, { ...cookieBase(), httpOnly: false, expires: expiresAt });
  return { csrfToken, expiresAt };
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await prisma.session.updateMany({ where: { id: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(SESSION_COOKIE, cookieBase());
  res.clearCookie(CSRF_COOKIE, cookieBase());
}

export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Loads the session (if any) onto req.user. Never throws for anonymous requests. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string') return next();
    const session = await prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() < now ||
      now - session.lastSeenAt.getTime() > env.SESSION_IDLE_MINUTES * 60_000 ||
      session.user.status !== 'ACTIVE'
    ) {
      return next();
    }
    // Throttle lastSeen writes to once a minute
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      status: session.user.status,
      sessionId: session.id,
      csrfToken: session.csrfToken,
    };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
  if (!isAdminRole(req.user.role)) return next(forbidden('Administrator access required'));
  next();
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
  if (req.user.role !== 'SUPERADMIN') return next(forbidden('Super-administrator access required'));
  next();
}

/** Ordinary users only — administrators do not hold platform balances or submit deposits. */
export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
  if (req.user.role !== 'USER') return next(forbidden('This action is only available to customer accounts'));
  next();
}

/** CSRF: every authenticated state-changing request must echo the session's CSRF token. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) return next(); // anonymous endpoints are protected by the Origin check + SameSite
  const header = req.headers[CSRF_HEADER];
  const expected = Buffer.from(req.user.csrfToken);
  const got = Buffer.from(typeof header === 'string' ? header : '');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return next(new AppError(403, 'CSRF_FAILED', 'Security token missing or invalid. Reload the page and try again.'));
  }
  next();
}

/** Actor must not be acting on their own account (e.g. approving their own deposit). */
export function assertNotSelf(actorId: string, targetUserId: string | null | undefined, what: string) {
  if (targetUserId && actorId === targetUserId) throw forbidden(`You cannot ${what} on your own account`);
}

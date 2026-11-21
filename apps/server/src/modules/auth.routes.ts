import { Router } from 'express';
import { z } from 'zod';
import { createSession, destroySession, hashPassword, requireAuth, revokeAllSessions, verifyPassword } from '../auth/auth.js';
import { audit } from '../audit/audit.js';
import { authLimiter, body, h } from '../middleware/http.js';
import { AppError } from '../lib/errors.js';
import { prisma, withTx } from '../lib/prisma.js';

export const authRouter = Router();

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(2).max(80),
  password,
  acceptTerms: z.literal(true, { message: 'You must accept the platform terms and risk disclosures' }),
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Dummy hash so unknown-email logins take the same time as wrong-password logins.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('timing-equaliser-not-a-real-password'));

const publicUser = (u: { id: string; email: string; name: string; role: string; status: string }) => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status });

authRouter.post(
  '/register',
  authLimiter,
  h(async (req, res) => {
    const input = body(registerSchema, req);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    const passwordHash = await hashPassword(input.password);
    const user = await withTx(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, role: 'USER' } });
      await audit(tx, { actorId: u.id, actorRole: 'USER', action: 'USER_REGISTERED', entityType: 'User', entityId: u.id, details: { email: u.email, acceptedTerms: true }, ip: req.ip });
      return u;
    });
    const { csrfToken } = await createSession(res, req, user.id);
    res.status(201).json({ user: publicUser(user), csrfToken });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  h(async (req, res) => {
    const input = body(z.object({ email: z.string().trim().toLowerCase(), password: z.string().max(200) }), req);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const fail = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (!user) {
      await verifyPassword(await getDummyHash(), input.password);
      throw fail();
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await withTx(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil },
        });
        await audit(tx, { actorId: user.id, actorRole: user.role, action: failed >= MAX_FAILED ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', entityType: 'User', entityId: user.id, ip: req.ip });
      });
      throw fail();
    }
    if (user.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
    await withTx(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await audit(tx, { actorId: user.id, actorRole: user.role, action: 'LOGIN', entityType: 'User', entityId: user.id, ip: req.ip });
    });
    const { csrfToken } = await createSession(res, req, user.id);
    res.json({ user: publicUser(user), csrfToken });
  }),
);

authRouter.post(
  '/logout',
  h(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  h(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: publicUser(req.user), csrfToken: req.user.csrfToken });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  authLimiter,
  h(async (req, res) => {
    const input = body(z.object({ currentPassword: z.string(), newPassword: password }), req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    const passwordHash = await hashPassword(input.newPassword);
    await withTx(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await audit(tx, { actorId: user.id, actorRole: user.role, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id, ip: req.ip });
    });
    await revokeAllSessions(user.id);
    const { csrfToken } = await createSession(res, req, user.id);
    res.json({ ok: true, csrfToken });
  }),
);

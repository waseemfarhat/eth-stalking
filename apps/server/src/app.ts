import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env, REPO_ROOT } from './config/env.js';
import { csrfProtection, loadSession } from './auth/auth.js';
import { apiLimiter, errorHandler, originCheck } from './middleware/http.js';
import { formatAmount } from './lib/money.js';
import { authRouter } from './modules/auth.routes.js';
import { userRouter } from './modules/user.routes.js';
import { adminRouter } from './modules/admin.routes.js';
import { publicRouter } from './modules/public.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
  // All BigInt values in this API are USDT base units (6 decimals) → exact decimal strings.
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? formatAmount(v) : v));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, originCheck, loadSession, csrfProtection);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', userRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }));

  // Serve the built frontend in "start" mode (single origin, no dev server needed).
  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  if (env.NODE_ENV !== 'test' && fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

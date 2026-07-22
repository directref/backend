import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import path from 'path';
import fs from 'fs';

import { env } from './config/env';
import { checkDbConnection } from './config/db';
import { configurePassport } from './config/passport';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

import authRouter from './modules/auth/auth.router';
import usersRouter from './modules/users/users.router';
import connectionsRouter from './modules/connections/connections.router';
import jobsRouter from './modules/jobs/jobs.router';
import applicationsRouter from './modules/applications/applications.router';
import notificationsRouter from './modules/notifications/notifications.router';
import invitesRouter from './modules/invites/invites.router';
import adminRouter from './modules/admin/admin.router';

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), env.UPLOADS_DIR, 'cvs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Passport strategies
configurePassport();

const app = express();

// ─── Global middleware ──────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      // Allow localhost and any local network IP
      const allowed = [
        env.FRONTEND_URL,
        'http://localhost:3001',
        'http://10.100.102.187:3001',
      ];
      if (allowed.includes(origin) || origin.match(/^http:\/\/192\.168\.\d+\.\d+:3001$/) || origin.match(/^http:\/\/10\.\d+\.\d+\.\d+:3001$/)) {
        callback(null, true);
      } else {
        callback(null, true); // allow all in dev
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret'],
  }),
);

if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(passport.initialize());

// ─── Rate limiter (global) ──────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const dbOk = await checkDbConnection();
  const uploadsOk = fs.existsSync(uploadDir);

  const status = dbOk && uploadsOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? 'connected' : 'disconnected',
      uploads: uploadsOk ? 'writable' : 'missing',
    },
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/admin',  adminRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ─── Error handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

export default app;

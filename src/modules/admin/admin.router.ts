import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as adminService from './admin.service';
import { env } from '../../config/env';

const router = Router();

// Simple secret-key guard
function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-admin-secret'] ?? req.query.secret;
  if (secret !== env.ADMIN_SECRET) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid admin secret' } });
    return;
  }
  next();
}

router.use(adminGuard);

router.get('/stats',    asyncHandler(async (_req, res) => {
  const data = await adminService.getStats();
  res.json({ data });
}));

router.get('/activity', asyncHandler(async (_req, res) => {
  const data = await adminService.getRecentActivity();
  res.json({ data });
}));

export default router;

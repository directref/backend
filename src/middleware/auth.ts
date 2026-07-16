import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { db } from '../config/db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface JwtPayload {
  sub: string;
  email: string;
  isReferrer: boolean;
  isSeeker: boolean;
}

/** Require a valid access token cookie. Attaches user to req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.access_token as string | undefined;
    if (!token) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    } catch {
      throw new AppError(401, 'TOKEN_INVALID', 'Access token is invalid or expired');
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user) {
      throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Like requireAuth but does not throw if no token — leaves req.user undefined. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) {
    return next();
  }
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (user) req.user = user;
  } catch {
    // silently ignore invalid token in optional auth
  }
  next();
}

/** Requires auth AND that the user has set is_referrer = true. */
export async function requireReferrer(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user?.isReferrer) {
      return next(new AppError(403, 'NOT_A_REFERRER', 'You must enable referrer mode to perform this action'));
    }
    next();
  });
}

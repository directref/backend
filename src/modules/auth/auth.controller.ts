import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { asyncHandler } from '../../utils/asyncHandler';
import { setAuthCookies, clearAuthCookies, verifyRefreshToken } from '../../services/tokenService';
import * as authService from './auth.service';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../config/env';

function makeTokenPayload(user: Express.User) {
  return {
    sub: user.id,
    email: user.email,
    isReferrer: user.isReferrer,
    isSeeker: user.isSeeker,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.register(req.body);
  setAuthCookies(res, makeTokenPayload(user));
  res.status(201).json({ data: authService.sanitizeUser(user), message: 'Registration successful. Please verify your email.' });
});

export const login = (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('local', (err: unknown, user: Express.User | false, info: { message?: string }) => {
    if (err) return next(err);
    if (!user) {
      return next(new AppError(401, 'INVALID_CREDENTIALS', info?.message ?? 'Invalid email or password'));
    }
    setAuthCookies(res, makeTokenPayload(user));
    res.json({ data: authService.sanitizeUser(user) });
  })(req, res, next);
};

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookies(res);
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: authService.sanitizeUser(req.user!) });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token as string | undefined;
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'No refresh token');

  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Refresh token is invalid or expired');
  }

  const user = await authService.getUserById(payload.sub);
  setAuthCookies(res, makeTokenPayload(user));
  res.json({ message: 'Token refreshed' });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  await authService.verifyEmail(String(req.params.token));
  res.json({ message: 'Email verified successfully' });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.email);
  res.json({ message: 'If that email exists, a reset link has been sent' });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.json({ message: 'Password reset successfully' });
});

export const googleCallback = (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('google', (err: unknown, user: Express.User | false) => {
    if (err || !user) {
      return res.redirect(`${env.FRONTEND_URL}/auth/callback?error=oauth_failed`);
    }
    setAuthCookies(res, makeTokenPayload(user));
    res.redirect(`${env.FRONTEND_URL}/auth/callback?success=true`);
  })(req, res, next);
};

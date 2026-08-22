import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import crypto from 'crypto';
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
      console.error('[auth] Google OAuth failed:', err ?? '(no user returned)');
      return res.redirect(`${env.FRONTEND_URL}/auth/callback?error=oauth_failed`);
    }
    setAuthCookies(res, makeTokenPayload(user));
    res.redirect(`${env.FRONTEND_URL}/auth/callback?success=true`);
  })(req, res, next);
};

// ─── LinkedIn OAuth (hand-rolled — LinkedIn's "Sign In using OpenID Connect")
// No passport strategy: the flow is just two HTTP calls (code → token,
// token → userinfo), and the last maintained LinkedIn passport strategy
// targets LinkedIn's old, now-retired scopes.

const LINKEDIN_STATE_COOKIE = 'li_oauth_state';
// Signed cookie carrying which account a "Connect" (not login) flow belongs
// to. Set only by linkedinConnect — its presence on the callback is what
// distinguishes "link this profile onto my existing account" from a normal
// LinkedIn login/signup. We can't rely on the regular access_token cookie
// for this: it's SameSite=Strict in production, so it wouldn't survive the
// cross-site redirect back from linkedin.com. This cookie is SameSite=Lax
// like the state cookie, so it does.
const LINKEDIN_CONNECT_UID_COOKIE = 'li_oauth_connect_uid';

function redirectToLinkedIn(res: Response, state: string): void {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: env.LINKEDIN_CALLBACK_URL,
    scope: 'openid profile email',
    state,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
}

export const linkedinLogin = (_req: Request, res: Response): void => {
  // Random, single-use value that round-trips through LinkedIn and back —
  // without it, an attacker could send a victim their own auth code and log
  // the victim into the attacker's LinkedIn-linked account (a login CSRF).
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(LINKEDIN_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes — plenty for the redirect round-trip
    signed: true,
  });

  redirectToLinkedIn(res, state);
};

/** Same handoff as linkedinLogin, but for a signed-in user connecting
 *  LinkedIn from Settings — the callback links to req.user's account
 *  instead of finding-or-creating one. */
export const linkedinConnect = (req: Request, res: Response): void => {
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(LINKEDIN_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    signed: true,
  });
  res.cookie(LINKEDIN_CONNECT_UID_COOKIE, req.user!.id, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    signed: true,
  });

  redirectToLinkedIn(res, state);
};

interface LinkedInTokenResponse {
  access_token: string;
}

interface LinkedInUserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export const linkedinCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  const expectedState = req.signedCookies?.[LINKEDIN_STATE_COOKIE] as string | undefined;
  const connectUserId = req.signedCookies?.[LINKEDIN_CONNECT_UID_COOKIE] as string | undefined;
  res.clearCookie(LINKEDIN_STATE_COOKIE);
  res.clearCookie(LINKEDIN_CONNECT_UID_COOKIE);

  // Connect-mode failures return to Settings; login-mode failures return to the login callback screen.
  const failureUrl = connectUserId
    ? `${env.FRONTEND_URL}/settings?linkedin=error`
    : `${env.FRONTEND_URL}/auth/callback?error=oauth_failed`;

  if (error || !code || !state || !expectedState || state !== expectedState) {
    res.redirect(failureUrl);
    return;
  }

  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.LINKEDIN_CALLBACK_URL,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as LinkedInTokenResponse;

    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) throw new Error(`userinfo fetch failed: ${profileRes.status}`);
    const profile = (await profileRes.json()) as LinkedInUserInfo;

    if (connectUserId) {
      // Linking onto the already-authenticated account — never creates or
      // switches accounts, and never touches the current session's cookies.
      try {
        await authService.linkLinkedInToUser(connectUserId, {
          linkedinId: profile.sub,
          avatarUrl: profile.picture ?? null,
        });
        res.redirect(`${env.FRONTEND_URL}/settings?linkedin=connected`);
      } catch (linkErr) {
        const reason = linkErr instanceof AppError && linkErr.code === 'LINKEDIN_ALREADY_LINKED' ? 'already_linked' : 'failed';
        res.redirect(`${env.FRONTEND_URL}/settings?linkedin=error&reason=${reason}`);
      }
      return;
    }

    const user = await authService.findOrCreateFromLinkedIn({
      linkedinId: profile.sub,
      email: profile.email?.toLowerCase() ?? null,
      fullName: profile.name || 'Unknown',
      avatarUrl: profile.picture ?? null,
    });

    setAuthCookies(res, makeTokenPayload(user));
    res.redirect(`${env.FRONTEND_URL}/auth/callback?success=true`);
  } catch (err) {
    console.error('[auth] LinkedIn OAuth failed:', err);
    res.redirect(failureUrl);
  }
});

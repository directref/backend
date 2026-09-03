import { Router } from 'express';
import passport from 'passport';
import * as ctrl from './auth.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';
import {
  RegisterSchema,
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from './auth.schemas';

const router = Router();

router.post('/register', authLimiter, validate(RegisterSchema), ctrl.register);
router.post('/login', authLimiter, validate(LoginSchema), ctrl.login);
router.post('/logout', requireAuth, ctrl.logout);
router.get('/me', requireAuth, ctrl.me);
router.post('/refresh', ctrl.refresh);
router.get('/verify-email/:token', ctrl.verifyEmail);
router.get('/verify-work-email/:token', ctrl.verifyWorkEmail);
router.post('/forgot-password', authLimiter, validate(ForgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', validate(ResetPasswordSchema), ctrl.resetPassword);

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
router.get('/google/callback', ctrl.googleCallback);

// LinkedIn OAuth — login/signup (anonymous)
router.get('/linkedin', ctrl.linkedinLogin);
// LinkedIn OAuth — connect to the current account (from Settings), not a login
router.get('/linkedin/connect', requireAuth, ctrl.linkedinConnect);
router.get('/callback/linkedin', ctrl.linkedinCallback);

export default router;

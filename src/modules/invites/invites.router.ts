import { Router } from 'express';
import * as ctrl from './invites.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// Public — no auth needed (checked before signup)
router.get('/join/:token', ctrl.getInviteInfo);

// Auth required
router.get('/link', requireAuth, ctrl.getInviteLink);
router.post('/redeem/:token', requireAuth, ctrl.redeemInvite);
router.get('/colleagues', requireAuth, ctrl.getColleagues);

export default router;

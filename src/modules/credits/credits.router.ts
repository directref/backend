import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './credits.controller';
import { PurchaseCreditsSchema } from './credits.schemas';

const router = Router();
router.use(requireAuth);

router.get('/balance', ctrl.getBalance);
router.get('/packages', ctrl.getPackages);
router.post('/purchase', validate(PurchaseCreditsSchema), ctrl.purchase);

export default router;

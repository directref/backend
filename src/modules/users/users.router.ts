import { Router } from 'express';
import * as ctrl from './users.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';
import { UpdateProfileSchema, SubmitWorkEmailSchema } from './users.schemas';

const router = Router();

router.use(requireAuth);

router.get('/me', ctrl.getMe);
router.patch('/me', validate(UpdateProfileSchema), ctrl.updateMe);
router.post('/me/work-email', authLimiter, validate(SubmitWorkEmailSchema), ctrl.submitWorkEmail);
router.delete('/me', ctrl.deleteMe);
router.get('/search', ctrl.searchUsers);
router.get('/:id', ctrl.getUser);

export default router;

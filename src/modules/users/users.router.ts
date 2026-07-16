import { Router } from 'express';
import * as ctrl from './users.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { UpdateProfileSchema } from './users.schemas';

const router = Router();

router.use(requireAuth);

router.get('/me', ctrl.getMe);
router.patch('/me', validate(UpdateProfileSchema), ctrl.updateMe);
router.delete('/me', ctrl.deleteMe);
router.get('/search', ctrl.searchUsers);
router.get('/:id', ctrl.getUser);

export default router;

import { Router } from 'express';
import * as ctrl from './users.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authLimiter, uploadLimiter } from '../../middleware/rateLimiter';
import { uploadCV } from '../../middleware/upload';
import { UpdateProfileSchema, SubmitWorkEmailSchema } from './users.schemas';

const router = Router();

router.use(requireAuth);

router.get('/me', ctrl.getMe);
router.patch('/me', validate(UpdateProfileSchema), ctrl.updateMe);
router.post('/me/work-email', authLimiter, validate(SubmitWorkEmailSchema), ctrl.submitWorkEmail);
router.post('/me/cv', uploadLimiter, uploadCV, ctrl.uploadMyCv);
router.delete('/me/cv', ctrl.removeMyCv);
router.get('/me/cv', ctrl.downloadMyCv);
router.get('/me/cv/preview', ctrl.previewMyCv);
router.delete('/me', ctrl.deleteMe);
router.get('/search', ctrl.searchUsers);
router.get('/:id', ctrl.getUser);

export default router;

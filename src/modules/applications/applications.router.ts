import { Router } from 'express';
import * as ctrl from './applications.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rateLimiter';
import { uploadCV } from '../../middleware/upload';
import { SubmitApplicationSchema, UpdateStatusSchema, ForwardToHRSchema } from './applications.schemas';

const router = Router();

router.use(requireAuth);

// Note: specific named routes before /:id
router.get('/inbox', ctrl.getInbox);
router.get('/mine', ctrl.getMine);

router.post('/', uploadLimiter, uploadCV, validate(SubmitApplicationSchema), ctrl.submitApplication);

router.get('/:id', ctrl.getApplication);
router.patch('/:id/status', validate(UpdateStatusSchema), ctrl.updateStatus);
router.post('/:id/forward', validate(ForwardToHRSchema), ctrl.forwardToHR);
router.get('/:id/cv', ctrl.downloadCV);
router.get('/:id/cv/preview', ctrl.previewCV);

export default router;

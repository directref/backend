import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as ctrl from './savedJobs.controller';

const router = Router();
router.use(requireAuth);

router.get('/',           ctrl.getSaved);
router.post('/:jobId',    ctrl.save);
router.delete('/:jobId',  ctrl.unsave);

export default router;

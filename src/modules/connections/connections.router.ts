import { Router } from 'express';
import * as ctrl from './connections.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { SendConnectionSchema, UpdateConnectionSchema } from './connections.schemas';

const router = Router();

router.use(requireAuth);

router.post('/', validate(SendConnectionSchema), ctrl.sendRequest);
router.get('/', ctrl.listConnections);
router.patch('/:id', validate(UpdateConnectionSchema), ctrl.updateConnection);
router.delete('/:id', ctrl.removeConnection);
router.get('/mutual/:userId', ctrl.getMutualInfo);

export default router;

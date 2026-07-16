import { Router } from 'express';
import * as ctrl from './notifications.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/',             ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.patch('/:id/read',   ctrl.markRead);
router.patch('/read-all',   ctrl.markAllRead);

export default router;

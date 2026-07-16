import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as notifService from './notifications.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const items = await notifService.getNotifications(req.user!.id);
  res.json({ data: items });
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await notifService.getUnreadCount(req.user!.id);
  res.json({ data: { count } });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await notifService.markRead(String(req.params.id), req.user!.id);
  res.status(204).send();
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await notifService.markAllRead(req.user!.id);
  res.status(204).send();
});

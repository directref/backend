import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as svc from './credits.service';

export const getBalance = asyncHandler(async (req: Request, res: Response) => {
  const data = await svc.getBalance(req.user!.id);
  res.json({ data });
});

export const getPackages = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: svc.getPackages() });
});

export const purchase = asyncHandler(async (req: Request, res: Response) => {
  const data = await svc.purchaseCredits(req.user!.id, req.body.packageId);
  res.json({ data });
});

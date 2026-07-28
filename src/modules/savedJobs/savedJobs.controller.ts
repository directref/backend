import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as svc from './savedJobs.service';

export const getSaved = asyncHandler(async (req: Request, res: Response) => {
  const data = await svc.getSavedJobs(req.user!.id);
  res.json({ data });
});

export const save = asyncHandler(async (req: Request, res: Response) => {
  await svc.saveJob(req.user!.id, req.params.jobId);
  res.status(204).send();
});

export const unsave = asyncHandler(async (req: Request, res: Response) => {
  await svc.unsaveJob(req.user!.id, req.params.jobId);
  res.status(204).send();
});

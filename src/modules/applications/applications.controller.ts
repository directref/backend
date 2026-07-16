import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as appService from './applications.service';
import { parsePagination } from '../../utils/pagination';
import { AppError } from '../../middleware/errorHandler';

export const submitApplication = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'CV file is required');
  const application = await appService.submitApplication(req.user!.id, req.body, req.file);
  res.status(201).json({ data: application });
});

export const getInbox = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const status = req.query.status as string | undefined;
  const data = await appService.getInbox(req.user!.id, status, page, limit);
  res.json({ data });
});

export const getMine = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const data = await appService.getMineApplications(req.user!.id, page, limit);
  res.json({ data });
});

export const getApplication = asyncHandler(async (req: Request, res: Response) => {
  const data = await appService.getApplicationById(String(req.params.id), req.user!.id);
  res.json({ data });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const data = await appService.updateStatus(String(req.params.id), req.user!.id, req.body.status);
  res.json({ data });
});

export const forwardToHR = asyncHandler(async (req: Request, res: Response) => {
  const data = await appService.forwardToHR(String(req.params.id), req.user!.id, req.body);
  res.json({ data });
});

export const downloadCV = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, originalName } = await appService.getCVPath(String(req.params.id), req.user!.id);
  res.download(filePath, originalName);
});

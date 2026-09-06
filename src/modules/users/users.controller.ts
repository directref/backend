import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as usersService from './users.service';
import { parsePagination } from '../../utils/pagination';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../config/env';

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getProfile(req.user!.id);
  res.json({ data: user });
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.updateProfile(req.user!.id, req.body);
  res.json({ data: user });
});

export const submitWorkEmail = asyncHandler(async (req: Request, res: Response) => {
  await usersService.requestWorkEmailVerification(req.user!.id, req.body.workEmail);
  res.json({ message: 'Verification email sent' });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getProfile(String(req.params.id));
  res.json({ data: user });
});

export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const q = String(req.query.q ?? '');
  const results = await usersService.searchUsers(q, page, limit, req.user!.id);
  res.json({ data: results });
});

export const deleteMe = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteAccount(req.user!.id);
  res.status(204).send();
});

export const uploadMyCv = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'CV file is required');
  const user = await usersService.uploadProfileCv(req.user!.id, req.file);
  res.json({ data: user });
});

export const removeMyCv = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.removeProfileCv(req.user!.id);
  res.json({ data: user });
});

export const downloadMyCv = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, originalName } = await usersService.getProfileCvPath(req.user!.id);
  res.download(filePath, originalName);
});

export const previewMyCv = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, mimeType } = await usersService.getProfileCvPreviewPath(req.user!.id);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${env.FRONTEND_URL}`);
  res.sendFile(filePath);
});

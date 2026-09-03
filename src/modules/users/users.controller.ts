import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as usersService from './users.service';
import { parsePagination } from '../../utils/pagination';

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

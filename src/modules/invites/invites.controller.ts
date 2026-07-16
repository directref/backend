import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as invitesService from './invites.service';

export const getInviteLink = asyncHandler(async (req: Request, res: Response) => {
  const url = await invitesService.getOrCreateInviteLink(req.user!.id);
  res.json({ data: { url } });
});

export const getInviteInfo = asyncHandler(async (req: Request, res: Response) => {
  const info = await invitesService.getInviteInfo(String(req.params.token));
  res.json({ data: info });
});

export const redeemInvite = asyncHandler(async (req: Request, res: Response) => {
  await invitesService.redeemInvite(String(req.params.token), req.user!.id);
  res.status(204).send();
});

export const getColleagues = asyncHandler(async (req: Request, res: Response) => {
  const companyName = req.query.company as string ?? req.user!.companyName ?? '';
  const colleagues = await invitesService.getColleagues(req.user!.id, companyName);
  res.json({ data: colleagues });
});

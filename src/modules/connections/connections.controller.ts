import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as connService from './connections.service';

export const sendRequest = asyncHandler(async (req: Request, res: Response) => {
  const conn = await connService.sendRequest(req.user!.id, req.body.addresseeId);
  res.status(201).json({ data: conn });
});

export const listConnections = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const direction = req.query.direction as string | undefined;
  const conns = await connService.listConnections(req.user!.id, status, direction);
  res.json({ data: conns });
});

export const updateConnection = asyncHandler(async (req: Request, res: Response) => {
  const conn = await connService.updateConnection(String(req.params.id), req.user!.id, req.body.status);
  res.json({ data: conn });
});

export const removeConnection = asyncHandler(async (req: Request, res: Response) => {
  await connService.removeConnection(String(req.params.id), req.user!.id);
  res.status(204).send();
});

export const getMutualInfo = asyncHandler(async (req: Request, res: Response) => {
  const info = await connService.getMutualInfo(req.user!.id, String(req.params.userId));
  res.json({ data: info });
});

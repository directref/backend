import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as jobsService from './jobs.service';
import { parsePagination } from '../../utils/pagination';

export const scrapeJob = asyncHandler(async (req: Request, res: Response) => {
  const data = await jobsService.scrapeJob(req.body.url);
  res.json({ data });
});

export const createJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await jobsService.createJob(req.user!.id, req.body);
  res.status(201).json({ data: job });
});

export const getFeed = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const result = await jobsService.getJobFeed(req.user!.id, page, limit);
  res.json(result);
});

export const searchJobs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const q = req.query.q as string | undefined;
  const company = req.query.company as string | undefined;
  const jobs = await jobsService.searchJobs(q, company, page, limit);
  res.json({ data: jobs });
});

export const getSuggestedJobs = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 6, 24);
  const jobs = await jobsService.getSuggestedJobs(req.user!.id, limit);
  res.json({ data: jobs });
});

export const getMyJobs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const jobs = await jobsService.getMyJobs(req.user!.id, page, limit);
  res.json({ data: jobs });
});

export const getJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await jobsService.getJobById(String(req.params.id));
  res.json({ data: job });
});

export const updateJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await jobsService.updateJob(String(req.params.id), req.user!.id, req.body);
  res.json({ data: job });
});

export const deleteJob = asyncHandler(async (req: Request, res: Response) => {
  await jobsService.deleteJob(String(req.params.id), req.user!.id);
  res.status(204).send();
});

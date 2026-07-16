import { z } from 'zod';

export const SubmitApplicationSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
  coverNote: z.string().max(2000).optional(),
});

export const UpdateStatusSchema = z.object({
  status: z.enum(['viewed', 'rejected']),
});

export const ForwardToHRSchema = z.object({
  hrEmail: z.string().email('Invalid HR email address'),
  referrerNote: z.string().max(2000).optional(),
});

export type SubmitApplicationDto = z.infer<typeof SubmitApplicationSchema>;
export type ForwardToHRDto = z.infer<typeof ForwardToHRSchema>;

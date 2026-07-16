import { z } from 'zod';

export const CreateJobSchema = z.object({
  sourceUrl: z.string().url('Must be a valid URL'),
  title: z.string().min(2).max(300),
  companyName: z.string().min(1).max(200),
  location: z.string().max(200).optional(),
  description: z.string().optional(),
  jobType: z.enum(['full-time', 'part-time', 'contract', 'freelance', 'internship']).optional(),
  salaryRange: z.string().max(100).optional(),
  bonusAmount: z.coerce.number().positive().optional(),
  bonusCurrency: z.string().max(10).optional(),
  bonusNotes: z.string().optional(),
  expiresAt: z.coerce.date().optional(),
});

export const UpdateJobSchema = CreateJobSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const ScrapeSchema = z.object({
  url: z.string().url('Must be a valid URL'),
});

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
export type UpdateJobDto = z.infer<typeof UpdateJobSchema>;

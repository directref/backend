import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  headline: z.string().max(400).optional(),
  companyName: z.string().max(200).optional().nullable(),
  isReferrer: z.boolean().optional(),
  isSeeker: z.boolean().optional(),
  avatarUrl: z.string().url().optional().nullable(),
  onboarded: z.boolean().optional(),
  desiredRole: z.string().max(200).optional().nullable(),
  preferredLocation: z.string().max(200).optional().nullable(),
});

export const SearchUsersSchema = z.object({
  q: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

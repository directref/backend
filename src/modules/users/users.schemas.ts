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
  yearsOfExperience: z.number().int().min(0).max(60).optional().nullable(),
  employmentType: z.enum(['full-time', 'part-time']).optional().nullable(),
  seniority: z.enum(['junior', 'mid', 'senior', 'lead', 'manager']).optional().nullable(),
  // Only allows clearing an OAuth-verified link — setting a real linkedinId
  // must go through the LinkedIn OAuth connect flow, never this endpoint.
  linkedinId: z.literal(null).optional(),
});

export const SubmitWorkEmailSchema = z.object({
  workEmail: z.string().email().max(320),
});

export const SearchUsersSchema = z.object({
  q: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

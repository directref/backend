import { z } from 'zod';

export const SubmitApplicationSchema = z.object({
  jobId: z.string().uuid('Invalid job ID'),
  coverNote: z.string().max(2000).optional(),
  // Multipart fields arrive as strings, not booleans — compare with
  // === 'true' at the point of use. Send the profile CV on file instead of
  // a fresh upload, confirmed by the seeker in the apply modal. Mutually
  // exclusive with a "cv" file in the same request (see submitApplication).
  useProfileCv: z.enum(['true', 'false']).optional(),
});

export const UpdateStatusSchema = z.object({
  status: z.enum(['viewed', 'forwarded', 'rejected', 'internally_submitted']),
});

export const SendMessageSchema = z.object({
  content: z.string().min(1, 'Message cannot be empty').max(2000, 'Message too long'),
});

export type SubmitApplicationDto = z.infer<typeof SubmitApplicationSchema>;
export type SendMessageDto = z.infer<typeof SendMessageSchema>;

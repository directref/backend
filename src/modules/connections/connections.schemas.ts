import { z } from 'zod';

export const SendConnectionSchema = z.object({
  addresseeId: z.string().uuid('Invalid user ID'),
});

export const UpdateConnectionSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

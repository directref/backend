import { z } from 'zod';

export const PurchaseCreditsSchema = z.object({
  packageId: z.enum(['starter', 'growth', 'bulk']),
});

export type PurchaseCreditsDto = z.infer<typeof PurchaseCreditsSchema>;

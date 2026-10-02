import { z } from 'zod';

export const receiptAccessQuerySchema = z.object({
  token: z.string().trim().min(32, 'Receipt access token is invalid.').max(512, 'Receipt access token is invalid.'),
}).strict();

export type ReceiptAccessQuery = z.infer<typeof receiptAccessQuerySchema>;

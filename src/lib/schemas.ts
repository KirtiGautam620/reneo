import { z } from 'zod';

export const createProductSchema = z.object({
  name:        z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  category:    z.string().trim().min(1).max(100),
  price_minor: z.number().int().nonnegative(),
  quantity:    z.number().int().nonnegative().default(0),
}).strict();

export const updateProductSchema = createProductSchema
  .partial()
  .omit({ quantity: true })
  .strict()
  .refine(obj => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

export const uuidParam = z.string().uuid();
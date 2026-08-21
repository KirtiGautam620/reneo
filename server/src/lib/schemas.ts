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

export const listProductsQuerySchema = z.object({
  q:          z.string().trim().min(1).max(100).optional(),
  category:   z.string().trim().min(1).optional(),
  min_price:  z.coerce.number().int().nonnegative().optional(),
  max_price:  z.coerce.number().int().nonnegative().optional(),
  in_stock:   z.enum(['true', 'false']).optional(),
  mine:       z.enum(['true', 'false']).optional(),
  sort:       z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
  cursor:     z.string().min(1).optional(),
}).strict().refine(
  q => q.min_price === undefined || q.max_price === undefined || q.min_price <= q.max_price,
  { message: 'min_price must not exceed max_price', path: ['min_price'] },
);

export const adjustInventorySchema = z.object({
  delta: z.number().int().refine(n => n !== 0, { message: 'delta must not be zero' }),
}).strict();

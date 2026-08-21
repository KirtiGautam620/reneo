import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError, conflict, badRequest, notFound } from '../lib/errors.js';

const router = Router();

const createOrderSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity:   z.number().int().positive(),
  }).strict()).min(1).max(50),
}).strict();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The failing product's id is carried in `details` as well as the message, so a
// client can name the offending line item without parsing prose.
const productDetails = (id: string) => (UUID_RE.test(id) ? { product_id: id } : null);

const PG_ERRORS: Record<string, (d: string) => AppError> = {
  P0002: () => new AppError(403, 'NOT_A_CUSTOMER', 'Only customers can place orders'),
  P0003: () => badRequest('Order must contain at least one item'),
  P0004: () => conflict('Idempotency key reused with a different payload', 'IDEMPOTENCY_KEY_REUSED'),
  P0005: () => badRequest('Quantity must be a positive integer'),
  P0006: (d) => notFound(`Product not found: ${d}`, productDetails(d)),
  P0007: (d) => conflict(`Product unavailable: ${d}`, 'PRODUCT_UNAVAILABLE', productDetails(d)),
  P0008: (d) => conflict(`Insufficient stock: ${d}`, 'OUT_OF_STOCK', productDetails(d)),
};

router.post('/', authenticate, requireRole('CUSTOMER'), async (req, res, next) => {
  try {
    const body = createOrderSchema.parse(req.body);
    const key  = req.header('Idempotency-Key') ?? null;

    const { data, error } = await req.db!.rpc('create_order', {
      p_items: body.items,
      p_idempotency_key: key,
    });

    if (error) {
      const code   = (error as any).code as string;
      const raw    = error.message ?? '';
      const detail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : '';
      const mapper = PG_ERRORS[code];
      if (mapper) throw mapper(detail.trim());
      throw error;
    }

    res.status(data.replayed ? 200 : 201).json(data);
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await req.db!
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;
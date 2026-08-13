import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createProductSchema, updateProductSchema, uuidParam } from '../lib/schemas.js';
import { notFound, badRequest, forbidden } from '../lib/errors.js';

const router = Router();

// CREATE
router.post('/', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const body = createProductSchema.parse(req.body);

    const { data: store } = await req.db!.from('stores').select('id').maybeSingle();
    if (!store) throw badRequest('Create a store before adding products');

    const { data: product, error } = await req.db!
      .from('products')
      .insert({
        store_id:    store.id,
        name:        body.name,
        description: body.description ?? null,
        category:    body.category,
        price_minor: body.price_minor,
      })
      .select()
      .single();

    if (error) throw error;

    const { error: invErr } = await req.db!
      .from('inventory')
      .insert({ product_id: product.id, quantity: body.quantity });

    if (invErr) throw invErr;

    res.status(201).json({ ...product, quantity: body.quantity });
  } catch (err) { next(err); }
});

//READ ONE
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const id = uuidParam.parse(req.params.id);

    const { data, error } = await req.db!
      .from('products')
      .select('*, inventory(quantity)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound('Product not found');
    res.json(data);
  } catch (err) { next(err); }
});

//UPDATE
router.patch('/:id', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const id   = uuidParam.parse(req.params.id);
    const body = updateProductSchema.parse(req.body);

    const { data, error } = await req.db!
      .from('products')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw forbidden('Product not found or not owned by you');
    res.json(data);
  } catch (err) { next(err); }
});

//ARCHIVE
router.delete('/:id', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const id = uuidParam.parse(req.params.id);

    const { data, error } = await req.db!
      .from('products')
      .update({ status: 'ARCHIVED', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw forbidden('Product not found or not owned by you');
    res.status(200).json({ id: data.id, status: data.status });
  } catch (err) { next(err); }
});

export default router;
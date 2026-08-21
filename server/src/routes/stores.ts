import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { conflict } from '../lib/errors.js';

const router = Router();
const storeSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

router.post('/', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const body = storeSchema.parse(req.body);

    const { data, error } = await req.db!
      .from('stores')
      .insert({ seller_id: req.user!.id, name: body.name })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw conflict('Seller already has a store');
      throw error;
    }
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.get('/me', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const { data, error } = await req.db!.from('stores').select().maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
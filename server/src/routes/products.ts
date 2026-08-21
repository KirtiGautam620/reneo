import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createProductSchema, updateProductSchema, uuidParam, listProductsQuerySchema, adjustInventorySchema } from '../lib/schemas.js';
import { sortSpec, encodeCursor, decodeCursor, keysetFilter } from '../lib/cursor.js';
import { AppError, notFound, badRequest, forbidden, conflict } from '../lib/errors.js';

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

// LIST — keyset pagination, not OFFSET. The cursor encodes the sort key of the
// last row returned, so each page is an index seek of constant cost.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const query = listProductsQuerySchema.parse(req.query);
    const spec  = sortSpec(query.sort);

    const inStockOnly = query.in_stock === 'true';
    const sellerView  = query.mine === 'true';
    const embed = inStockOnly ? 'inventory!inner(quantity)' : 'inventory(quantity)';

    // The seller view is scoped to the caller's own store. RLS already returns
    // only that store, so no seller_id filter is needed to find it.
    let storeId: string | null = null;
    if (sellerView) {
      const { data: store, error: storeErr } = await req.db!
        .from('stores').select('id').maybeSingle();
      if (storeErr) throw storeErr;
      // No store (a customer, or a seller who has not created one yet) owns no
      // products, so the answer is an empty page rather than an error.
      if (!store) {
        res.json({ data: [], next_cursor: null, limit: query.limit });
        return;
      }
      storeId = store.id;
    }

    let q = req.db!
      .from('products')
      .select(`id, name, description, category, price_minor, currency, status, created_at, ${embed}`);

    if (sellerView) {
      // A seller manages archived products too — RLS permits reading them, and
      // they must stay visible to be found after archiving.
      q = q.eq('store_id', storeId!);
    } else {
      // RLS additionally lets a seller see their own ARCHIVED rows; the
      // marketplace listing is ACTIVE-only regardless of who is asking.
      q = q.eq('status', 'ACTIVE');
    }

    if (query.q)        q = q.textSearch('search_vector', query.q, { config: 'simple', type: 'plain' });
    if (query.category) q = q.eq('category', query.category);
    if (query.min_price !== undefined) q = q.gte('price_minor', query.min_price);
    if (query.max_price !== undefined) q = q.lte('price_minor', query.max_price);
    if (inStockOnly)    q = q.gt('inventory.quantity', 0);

    if (query.cursor) {
      q = q.or(keysetFilter(decodeCursor(query.cursor, query.sort), spec));
    }

    // Fetch one extra row to learn whether a further page exists without a
    // second count query.
    const { data, error } = await q
      .order(spec.column, { ascending: spec.ascending })
      .order('id',        { ascending: spec.ascending })
      .limit(query.limit + 1);

    if (error) throw error;

    const rows    = data ?? [];
    const hasMore = rows.length > query.limit;
    const page    = hasMore ? rows.slice(0, query.limit) : rows;

    const items = page.map(row => {
      const { inventory, ...product } = row as typeof row & {
        inventory: { quantity: number } | null;
      };
      // POST /products is not atomic, so a product can briefly exist with no
      // inventory row. Report it as zero rather than omitting the field.
      return { ...product, inventory: { quantity: inventory?.quantity ?? 0 } };
    });

    const last = page.at(-1) as { id: string; created_at: string; price_minor: number } | undefined;

    res.json({
      data: items,
      next_cursor: hasMore && last
        ? encodeCursor({ v: last[spec.column], id: last.id, s: query.sort })
        : null,
      limit: query.limit,
    });
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


// RESTOCK — relative adjustment, so it cannot overwrite a concurrent order's
// decrement. Absolute writes are refused by PATCH /products/{id} for that reason.
const INVENTORY_PG_ERRORS: Record<string, (d: string) => AppError> = {
  P0010: () => forbidden('Create a store before managing inventory'),
  P0011: () => badRequest('delta must not be zero'),
  P0012: (d) => conflict(`Insufficient stock: ${d}`, 'OUT_OF_STOCK',
    /^[0-9a-f-]{36}$/i.test(d) ? { product_id: d } : null),
  P0013: () => forbidden('Product not found or not owned by you'),
};

router.patch('/:id/inventory', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const id   = uuidParam.parse(req.params.id);
    const body = adjustInventorySchema.parse(req.body);

    const { data, error } = await req.db!.rpc('adjust_inventory', {
      p_product_id: id,
      p_delta:      body.delta,
    });

    if (error) {
      const code   = (error as { code?: string }).code ?? '';
      const raw    = error.message ?? '';
      const detail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : '';
      const mapper = INVENTORY_PG_ERRORS[code];
      if (mapper) throw mapper(detail);
      throw error;
    }

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
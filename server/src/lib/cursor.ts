import { badRequest } from './errors.js';

export type SortKey = 'newest' | 'price_asc' | 'price_desc';

type SortSpec = {
  column: 'created_at' | 'price_minor';
  ascending: boolean;
};

/**
 * Keyset pagination sorts. Every sort ends in `id` so the ordering is total —
 * without a unique tiebreak, rows sharing a sort value can straddle a page
 * boundary and be returned twice or skipped. Each pair matches a partial index
 * in 0006_search_indexes.sql, so a page is an index seek at any depth.
 */
const SORTS: Record<SortKey, SortSpec> = {
  newest:     { column: 'created_at',  ascending: false },
  price_asc:  { column: 'price_minor', ascending: true  },
  price_desc: { column: 'price_minor', ascending: false },
};

export const sortSpec = (sort: SortKey): SortSpec => SORTS[sort];

type CursorPayload = {
  /** Sort-key value of the last row on the previous page. */
  v: string | number;
  /** Tiebreak: that row's id. */
  id: string;
  /** The sort the cursor was issued for. */
  s: SortKey;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, sort: SortKey): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Malformed cursor');
  }

  const c = parsed as Partial<CursorPayload>;
  if (
    !c || typeof c !== 'object' ||
    (typeof c.v !== 'string' && typeof c.v !== 'number') ||
    typeof c.id !== 'string' ||
    typeof c.s !== 'string'
  ) {
    throw badRequest('Malformed cursor');
  }

  // The cursor encodes a position in one specific ordering. Replaying it under
  // a different sort would silently return the wrong slice.
  if (c.s !== sort) {
    throw badRequest(`Cursor was issued for sort=${c.s} and cannot be used with sort=${sort}`);
  }

  return c as CursorPayload;
}

/**
 * The keyset predicate, as a PostgREST `or` filter:
 *   (col < v) OR (col = v AND id < id)   -- descending
 *   (col > v) OR (col = v AND id > id)   -- ascending
 */
export function keysetFilter(cursor: CursorPayload, spec: SortSpec): string {
  const op = spec.ascending ? 'gt' : 'lt';
  const v  = typeof cursor.v === 'string' ? `"${cursor.v}"` : cursor.v;
  return `${spec.column}.${op}.${v},and(${spec.column}.eq.${v},id.${op}.${cursor.id})`;
}

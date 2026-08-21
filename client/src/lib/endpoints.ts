import type { ProductListQuery } from '@/types/api';

/**
 * Every API path in one place. Nothing else in the app builds a URL by hand.
 */

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const endpoints = {
  health: '/health',

  stores: {
    root: '/stores',
    me: '/stores/me',
  },

  products: {
    root: '/products',
    list: (query: ProductListQuery = {}) =>
      `/products${queryString({
        q: query.q,
        category: query.category,
        min_price: query.min_price,
        max_price: query.max_price,
        // The spec types in_stock as the string 'true' | 'false', not a boolean.
        in_stock: query.in_stock === undefined ? undefined : String(query.in_stock),
        mine: query.mine === undefined ? undefined : String(query.mine),
        sort: query.sort,
        limit: query.limit,
        cursor: query.cursor,
      })}`,
    detail: (id: string) => `/products/${encodeURIComponent(id)}`,
    inventory: (id: string) => `/products/${encodeURIComponent(id)}/inventory`,
  },

  orders: {
    root: '/orders',
    list: '/orders',
  },
} as const;

'use client';

import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import type {
  Paginated,
  ProductListItem,
  ProductListQuery,
  ProductWithInventory,
} from '@/types/api';

/**
 * Query key factory. Every products key descends from `all`, so a single
 * invalidation after checkout refreshes both the catalogue and any open detail
 * view — stock counts move the moment an order commits.
 */
export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (query: ProductListQuery) => [...productKeys.lists(), query] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

/**
 * The list endpoint is keyset-paginated: pass the previous response's
 * `next_cursor` as `cursor`, and only ever move forward. A cursor is bound to
 * the sort it was issued for, which is why `sort` is part of the query key —
 * changing it starts a fresh chain of pages instead of reusing a stale cursor.
 */
export function useProducts(query: ProductListQuery = {}) {
  return useInfiniteQuery({
    queryKey: productKeys.list(query),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Paginated<ProductListItem>>(
        endpoints.products.list({ ...query, cursor: pageParam })
      ),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: () =>
      api.get<ProductWithInventory>(endpoints.products.detail(id!)),
  });
}

/**
 * The cart holds product ids only, so line items are resolved one product at a
 * time. Each result lands under the same key as `useProduct`, so the detail
 * page and the cart share one cache entry.
 */
export function useCartProducts(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: productKeys.detail(id),
      queryFn: () =>
        api.get<ProductWithInventory>(endpoints.products.detail(id)),
    })),
  });
}

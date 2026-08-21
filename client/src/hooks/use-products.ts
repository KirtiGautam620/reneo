'use client';

import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import type {
  AdjustInventoryRequest,
  AdjustInventoryResult,
  ArchiveProductResult,
  CreateProductRequest,
  Paginated,
  Product,
  ProductListItem,
  ProductListQuery,
  ProductWithInventory,
  UpdateProductRequest,
} from '@/types/api';

/**
 * Query key factory. Every products key descends from `all`, so one
 * invalidation refreshes the marketplace listing, the seller's own listing and
 * any open detail view together — which is what a price or stock change needs,
 * since the same product is visible through all three.
 */
export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (query: ProductListQuery) => [...productKeys.lists(), query] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
  categories: () => [...productKeys.all, 'categories'] as const,
};

/* ── Reads ─────────────────────────────────────────────────────────────── */

/**
 * Keyset-paginated marketplace listing. `sort` is part of the key because a
 * cursor is only valid for the sort it was issued with — changing it must start
 * a fresh chain of pages rather than replay a stale cursor.
 */
export function useProducts(query: ProductListQuery = {}) {
  const queryClient = useQueryClient();
  const queryKey = productKeys.list(query);
  // Stable dependency: the key array is rebuilt every render, but its contents
  // only change when the filters do.
  const keyString = JSON.stringify(queryKey);

  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Paginated<ProductListItem>>(
        // The cursor goes out as `cursor`; the ordering it was issued for goes
        // out as `sort`, and both must agree or the server returns 400.
        endpoints.products.list({ ...query, cursor: pageParam })
      ),
    // Must be undefined, not null: react-query treats null as a valid page
    // param and would keep fetching, whereas undefined means "no more pages".
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  /**
   * A cursor is only valid for the sort it was issued with, and the server
   * rejects a mismatched or malformed one with 400. Because `sort` is part of
   * the query key this should not arise in normal use — changing the sort
   * starts a fresh chain rather than replaying an old cursor — but a cursor
   * held across a deploy, or one that has been tampered with, would.
   *
   * The recovery is to drop the accumulated pages and start from the first one
   * again, which the reader barely notices. Showing an error instead would
   * strand them on a half-loaded list they cannot advance.
   *
   * Guarded on already having a good page: if the *first* request 400s — an
   * out-of-range filter, say — there is no cursor to blame and resetting would
   * loop for ever.
   */
  const rejectedCursor =
    result.error instanceof ApiError &&
    result.error.status === 400 &&
    (result.data?.pages.length ?? 0) > 0;

  useEffect(() => {
    if (!rejectedCursor) return;
    void queryClient.resetQueries({ queryKey: JSON.parse(keyString) as unknown[] });
  }, [rejectedCursor, keyString, queryClient]);

  return result;
}

/**
 * Categories for the marketplace filter.
 *
 * The API has no categories endpoint, so the option list is derived from one
 * unfiltered page of products. Two consequences worth stating: a category that
 * only appears beyond this page will not be offered, and the list is
 * deliberately fetched *unfiltered* — deriving it from the filtered listing
 * would collapse the options to whichever category is already selected.
 */
export function useProductCategories() {
  return useQuery({
    queryKey: productKeys.categories(),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const page = await api.get<Paginated<ProductListItem>>(
        endpoints.products.list({ limit: 100 })
      );
      return [...new Set(page.data.map((item) => item.category))].sort((a, b) =>
        a.localeCompare(b)
      );
    },
  });
}

/**
 * The seller's own catalogue. `mine=true` scopes the listing to the caller's
 * store and is the only view that returns ARCHIVED products — a seller has to
 * be able to find a product after archiving it.
 *
 * Stock arrives as `inventory.quantity` on each list item; there is no `stock`
 * field on a product.
 */
export function useSellerProducts(query: Omit<ProductListQuery, 'mine'> = {}) {
  return useProducts({ ...query, mine: true });
}

/** GET /products/{id} returns ProductWithInventory — Product plus `inventory`. */
export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<ProductWithInventory>(endpoints.products.detail(id!)),
  });
}

/** Resolves cart line items one product at a time, sharing `useProduct`'s cache. */
export function useCartProducts(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: productKeys.detail(id),
      queryFn: () => api.get<ProductWithInventory>(endpoints.products.detail(id)),
    })),
  });
}

/* ── Writes ────────────────────────────────────────────────────────────── */

/**
 * A product's price, availability and stock are visible from the marketplace
 * listing, the seller listing and the detail view at once, so every write
 * invalidates the whole tree rather than one branch of it.
 */
function useInvalidateProducts() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: productKeys.all,
      // These mutations usually navigate straight after (create → edit,
      // archive → list), so the destination's query is not mounted yet. The
      // default only refetches *active* queries, which would land the seller on
      // a cached list still showing the product as it was before the write.
      refetchType: 'all',
    });
}

/** POST /products. `quantity` here is the *initial* stock and cannot be resent later. */
export function useCreateProduct() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (body: CreateProductRequest) =>
      api.post<Product>(endpoints.products.root, body),
    onSuccess: () => invalidate(),
  });
}

/**
 * PATCH /products/{id}. Accepts name, description, category and price_minor
 * only — sending `quantity` is a 400, because an absolute stock write would
 * race a concurrent order's decrement.
 */
export function useUpdateProduct(id: string) {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (body: UpdateProductRequest) =>
      api.patch<Product>(endpoints.products.detail(id), body),
    onSuccess: () => invalidate(),
  });
}

/**
 * DELETE /products/{id} is a soft delete: it sets status to ARCHIVED and
 * returns `{ id, status }`. The row survives because order_items references it,
 * so a hard delete would either break the foreign key or destroy order history.
 */
export function useArchiveProduct() {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ArchiveProductResult>(endpoints.products.detail(id)),
    onSuccess: () => invalidate(),
  });
}

/**
 * PATCH /products/{id}/inventory — the only way to change stock after creation.
 * The payload is a signed, relative `delta`, so an order that takes stock while
 * this is in flight is composed with rather than overwritten.
 */
export function useAdjustInventory(id: string) {
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (body: AdjustInventoryRequest) =>
      api.patch<AdjustInventoryResult>(endpoints.products.inventory(id), body),
    onSuccess: () => invalidate(),
  });
}

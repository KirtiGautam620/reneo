'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import { ApiError } from '@/lib/api-client';
import type { CreateStoreRequest, Store } from '@/types/api';

export const storeKeys = {
  all: ['stores'] as const,
  me: () => [...storeKeys.all, 'me'] as const,
};

/**
 * GET /stores/me.
 *
 * A seller without a store is a normal state, not an error. The spec types the
 * 200 body as `oneOf: [Store, null]`, and the API really does answer
 * `200` with a literal `null` body — it does **not** 404. So "no store yet" and
 * "request failed" are genuinely different outcomes here, and are kept apart:
 * `needsStore` is true only once the query has succeeded *and* returned null.
 *
 * No seller_id filter is sent; RLS restricts the visible row to the caller's own
 * store.
 */
export function useMyStore() {
  const query = useQuery({
    queryKey: storeKeys.me(),
    queryFn: () => api.get<Store | null>(endpoints.stores.me),
  });

  return {
    ...query,
    /** The store, or null when the seller has not created one. */
    store: query.data ?? null,
    hasStore: query.isSuccess && query.data != null,
    /** Settled, and the seller genuinely has no store — safe to offer the form. */
    needsStore: query.isSuccess && query.data == null,
  };
}

export function useCreateStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateStoreRequest) =>
      api.post<Store>(endpoints.stores.root, body),

    // Returning the promise keeps the mutation pending until the refetch lands,
    // so the form does not flash an empty dashboard in between.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storeKeys.me() }),

    onError: (error) => {
      /**
       * 409 means the UNIQUE constraint on stores.seller_id rejected a second
       * store — so one already exists and this client's view was stale. The
       * truthful response is to go and read the store that is actually there,
       * not to show the seller an error about a store they already own.
       */
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: storeKeys.me() });
      }
    },
  });
}

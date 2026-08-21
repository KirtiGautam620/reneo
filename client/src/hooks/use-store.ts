'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import type { CreateStoreRequest, Store } from '@/types/api';

export const storeKeys = {
  all: ['stores'] as const,
  me: () => [...storeKeys.all, 'me'] as const,
};

/**
 * GET /stores/me applies no seller_id filter — RLS restricts the visible rows
 * to the caller's own store. It resolves to null when the seller has not
 * created one yet, which is a valid state, not an error.
 */
export function useStore() {
  return useQuery({
    queryKey: storeKeys.me(),
    queryFn: () => api.get<Store | null>(endpoints.stores.me),
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateStoreRequest) =>
      api.post<Store>(endpoints.stores.root, body),
    onSuccess: (store) => {
      // Seed the cache so the dashboard switches out of its empty state without
      // a second round trip.
      queryClient.setQueryData(storeKeys.me(), store);
    },
  });
}

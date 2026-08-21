'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import type { Collection, Order } from '@/types/api';

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: () => [...orderKeys.lists()] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
};

/**
 * GET /orders applies no filter of its own — RLS decides visibility, so a
 * customer sees their own orders and a seller sees orders containing one of
 * their line items. The endpoint is unpaginated and the server caps it at the
 * 50 most recent.
 */
export function useOrders() {
  return useQuery({
    queryKey: orderKeys.list(),
    queryFn: () => api.get<Collection<Order>>(endpoints.orders.list),
  });
}

/**
 * There is no GET /orders/{id} in the API, so a single order is selected from
 * the list rather than fetched. Two consequences worth knowing:
 *  - opening an order costs no extra request when the list is already cached;
 *  - an order outside the 50 most recent cannot be addressed by URL at all.
 * Adding the endpoint would remove the second limit.
 */
export function useOrder(id: string | undefined) {
  const query = useOrders();
  const order = id
    ? (query.data?.data.find((candidate) => candidate.id === id) ?? null)
    : null;

  return {
    ...query,
    order,
    /** Loaded successfully, but the id was not among the visible orders. */
    isMissing: query.isSuccess && Boolean(id) && order === null,
  };
}

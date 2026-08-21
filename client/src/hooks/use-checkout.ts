'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { endpoints } from '@/lib/endpoints';
import { describeCheckoutError, type CheckoutProblem } from '@/lib/checkout-errors';
import { productKeys } from './use-products';
import { orderKeys } from './use-orders';
import type { CartItem } from './use-cart';
import type { CreateOrderRequest, OrderResult } from '@/types/api';

/**
 * One checkout attempt: an idempotency key bound to the exact payload it was
 * issued for.
 *
 * The key alone is not enough. The server matches a replay on `md5(items)` as
 * well as the key, so the retry must resend a byte-identical body — a key
 * reused with a changed cart is rejected as IDEMPOTENCY_KEY_REUSED. Pinning
 * both together is what makes a retry a retry rather than a second order.
 */
interface Attempt {
  key: string;
  fingerprint: string;
  payload: CreateOrderRequest;
}

/**
 * Sort by product_id so two submissions of the same cart serialise identically
 * regardless of the order things were added in.
 */
function buildPayload(items: readonly CartItem[]): CreateOrderRequest {
  return {
    items: [...items]
      .map((item) => ({ product_id: item.product_id, quantity: item.quantity }))
      .sort((a, b) => a.product_id.localeCompare(b.product_id)),
  };
}

export function useCheckout() {
  const queryClient = useQueryClient();
  const attemptRef = useRef<Attempt | null>(null);
  const [problem, setProblem] = useState<CheckoutProblem | null>(null);

  const mutation = useMutation<
    OrderResult,
    unknown,
    { items: readonly CartItem[]; productName: (id: string) => string | undefined }
  >({
    mutationFn: ({ items }) => {
      const payload = buildPayload(items);
      const fingerprint = JSON.stringify(payload);

      // Same cart as the failed attempt → same key, so a retry after a timeout
      // replays the original order instead of creating a second one. Different
      // cart → a new attempt, because the old key would be rejected anyway.
      if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
        attemptRef.current = { key: crypto.randomUUID(), fingerprint, payload };
      }

      const attempt = attemptRef.current;
      return api.post<OrderResult>(endpoints.orders.root, attempt.payload, {
        headers: { 'Idempotency-Key': attempt.key },
      });
    },

    onSuccess: () => {
      // The attempt is spent; the next checkout starts a fresh key.
      attemptRef.current = null;
      setProblem(null);
    },

    onError: (error, variables) => {
      const described = describeCheckoutError(error, variables.productName);
      setProblem(described);

      // A stock conflict means the numbers on screen are already out of date.
      if (described.refreshStock) {
        void queryClient.invalidateQueries({ queryKey: productKeys.all });
      }
      // The key is burnt; the next submit must issue a new one.
      if (described.code === 'IDEMPOTENCY_KEY_REUSED') {
        attemptRef.current = null;
      }
    },
  });

  const invalidateAfterOrder = useCallback(async () => {
    await Promise.all([
      // Stock changed for everything just bought — refresh catalogue and details.
      queryClient.invalidateQueries({ queryKey: productKeys.all }),
      queryClient.invalidateQueries({ queryKey: orderKeys.all }),
    ]);
  }, [queryClient]);

  const reset = useCallback(() => {
    attemptRef.current = null;
    setProblem(null);
    mutation.reset();
  }, [mutation]);

  return {
    checkout: mutation.mutateAsync,
    isPending: mutation.isPending,
    problem,
    reset,
    invalidateAfterOrder,
  };
}

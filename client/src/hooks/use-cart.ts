'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CreateOrderItem } from '@/types/api';

/**
 * Client-side cart. There is no /cart endpoint — the cart is a local intent to
 * buy, not server state.
 *
 * Only { product_id, quantity } is ever stored. Price and name are deliberately
 * absent: the server resolves both inside the order transaction, so a cached
 * price here could only ever be stale or forged, never authoritative.
 */

export type CartItem = CreateOrderItem;

const STORAGE_KEY = 'reneo.cart.v1';

/** POST /orders caps an order at 50 line items and 1 minimum per item. */
export const MAX_LINE_ITEMS = 50;
export const MAX_QUANTITY = 9999;

/** Stable identity, so the server snapshot never triggers a re-render loop. */
const EMPTY: readonly CartItem[] = Object.freeze([]);

const listeners = new Set<() => void>();

// getSnapshot must return a referentially stable value between changes, so the
// parsed array is cached and only rebuilt when the raw string actually differs.
let rawCache: string | null = null;
let parsedCache: readonly CartItem[] = EMPTY;

function parse(raw: string | null): readonly CartItem[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const items = value.filter(
      (item): item is CartItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as CartItem).product_id === 'string' &&
        Number.isInteger((item as CartItem).quantity) &&
        (item as CartItem).quantity > 0
    );
    return items.length > 0 ? items : EMPTY;
  } catch {
    // Corrupted or hand-edited storage should empty the cart, not crash the app.
    return EMPTY;
  }
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari private mode and blocked storage both throw on access.
    return null;
  }
}

function getSnapshot(): readonly CartItem[] {
  // During server render there is no localStorage at all.
  if (typeof window === 'undefined') return EMPTY;
  const raw = readStorage();
  if (raw !== rawCache) {
    rawCache = raw;
    parsedCache = parse(raw);
  }
  return parsedCache;
}

/** The server has no cart, so it always renders the empty one. */
function getServerSnapshot(): readonly CartItem[] {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Keep tabs in sync: `storage` fires in every *other* tab on a write.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function write(items: readonly CartItem[]): void {
  const next = items.filter((item) => item.quantity > 0);
  const raw = JSON.stringify(next);
  try {
    if (next.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Storage unavailable: keep the in-memory snapshot so the session still works.
  }
  rawCache = next.length === 0 ? null : raw;
  parsedCache = next.length === 0 ? EMPTY : next;
  for (const listener of listeners) listener();
}

const clampQuantity = (quantity: number) =>
  Math.min(MAX_QUANTITY, Math.max(0, Math.trunc(quantity)));

export function useCart() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addItem = useCallback((productId: string, quantity = 1) => {
    const amount = clampQuantity(quantity);
    if (amount <= 0) return;

    const current = getSnapshot();
    const existing = current.find((item) => item.product_id === productId);

    if (existing) {
      write(
        current.map((item) =>
          item.product_id === productId
            ? { ...item, quantity: clampQuantity(item.quantity + amount) }
            : item
        )
      );
      return;
    }

    if (current.length >= MAX_LINE_ITEMS) return;
    write([...current, { product_id: productId, quantity: amount }]);
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    const amount = clampQuantity(quantity);
    const current = getSnapshot();
    // Zero means remove: an empty line item cannot be sent to POST /orders.
    write(
      amount <= 0
        ? current.filter((item) => item.product_id !== productId)
        : current.map((item) =>
            item.product_id === productId ? { ...item, quantity: amount } : item
          )
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    write(getSnapshot().filter((item) => item.product_id !== productId));
  }, []);

  const clear = useCallback(() => {
    write(EMPTY);
  }, []);

  const itemCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items]
  );

  const isFull = items.length >= MAX_LINE_ITEMS;

  return { items, addItem, updateQuantity, removeItem, clear, itemCount, isFull };
}

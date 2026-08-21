'use client';

import { use } from 'react';
import Link from 'next/link';
import { useOrder } from '@/hooks/use-orders';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { OrderItem, OrderStatus } from '@/types/api';
import styles from '../orders.module.css';

const STATUS_CLASS: Record<OrderStatus, string> = {
  CONFIRMED: styles.statusConfirmed,
  CANCELLED: styles.statusCancelled,
  PENDING: styles.statusPending,
};

/**
 * An order carries no seller_id of its own — it may span several sellers — so
 * the grouping key lives on each line item.
 *
 * The API exposes only the seller's *id* on an order item, with no store or
 * seller name anywhere on the order response, so groups are labelled by
 * position with the id shown for reference. Putting a store name on OrderItem
 * would be the fix; inventing a lookup endpoint here would not.
 */
function groupBySeller(items: OrderItem[]): { sellerId: string; items: OrderItem[] }[] {
  const groups = new Map<string, OrderItem[]>();
  for (const item of items) {
    const existing = groups.get(item.seller_id);
    if (existing) existing.push(item);
    else groups.set(item.seller_id, [item]);
  }
  return [...groups].map(([sellerId, grouped]) => ({ sellerId, items: grouped }));
}

const subtotal = (items: OrderItem[]) =>
  items.reduce((sum, item) => sum + item.subtotal_minor, 0);

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { order, isPending, isError, isMissing, error } = useOrder(id);

  if (isPending) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>Loading order…</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className={styles.page}>
        <Link href="/orders" className={styles.back}>
          ← Your orders
        </Link>
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error instanceof ApiError ? error.message : 'Could not load your orders.'}
        </p>
      </main>
    );
  }

  if (isMissing || !order) {
    return (
      <main className={styles.page}>
        <Link href="/orders" className={styles.back}>
          ← Your orders
        </Link>
        <p className={styles.notice}>
          This order is not among your visible orders. The API returns the 50
          most recent, so older orders cannot be opened directly.
        </p>
      </main>
    );
  }

  const groups = groupBySeller(order.order_items);
  const multiSeller = groups.length > 1;

  return (
    <main className={styles.page}>
      <Link href="/orders" className={styles.back}>
        ← Your orders
      </Link>

      <h1 className={styles.heading}>Order</h1>
      <div className={styles.meta}>
        <span className={`${styles.status} ${STATUS_CLASS[order.status]}`}>
          {order.status}
        </span>
        <span className={styles.subheading}>{formatDateTime(order.created_at)}</span>
      </div>
      <p className={styles.metaId}>{order.id}</p>

      {multiSeller && (
        <p className={`${styles.subheading} ${styles.stackMd}`}>
          This order is fulfilled by {groups.length} sellers.
        </p>
      )}

      {groups.map((group, index) => (
        <section key={group.sellerId} className={styles.group}>
          <header className={styles.groupHead}>
            <span className={styles.groupTitle}>
              {multiSeller ? `Seller ${index + 1}` : 'Seller'}
            </span>
            <span className={styles.groupSubtotal}>
              {formatMoney(subtotal(group.items), order.currency)}
            </span>
          </header>

          <ul className={styles.items}>
            {group.items.map((item) => (
              <li key={item.id} className={styles.item}>
                {/*
                  product_name and unit_price_minor are snapshots taken at
                  purchase time and are rendered exactly as stored. If the seller
                  reprices or renames the product tomorrow, what you were charged
                  here does not change.
                */}
                <span className={styles.itemName}>{item.product_name}</span>
                <span className={styles.itemUnit}>
                  {item.quantity} ×{' '}
                  {formatMoney(item.unit_price_minor, order.currency)}
                </span>
                <span className={styles.itemSubtotal}>
                  {formatMoney(item.subtotal_minor, order.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/*
        Unlike the seller's view, the whole-order total is this customer's own
        outlay, so showing it is correct here.
      */}
      <div className={styles.total}>
        <span className={styles.totalLabel}>Total paid</span>
        <span className={styles.totalValue}>
          {formatMoney(order.total_minor, order.currency)}
        </span>
      </div>
    </main>
  );
}

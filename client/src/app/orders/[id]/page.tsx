'use client';

import { use } from 'react';
import Link from 'next/link';
import { useOrder } from '@/hooks/use-orders';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import styles from '../orders.module.css';

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
        <Link href="/" className={styles.back}>
          ← Catalogue
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
          ← All orders
        </Link>
        <p className={styles.notice}>
          This order is not among your visible orders. The API returns the 50
          most recent, so older orders cannot be opened directly.
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <Link href="/orders" className={styles.back}>
        ← All orders
      </Link>

      <h1 className={styles.heading}>Order placed</h1>
      <p className={styles.confirmation}>
        Your order was placed and its stock is reserved.
      </p>

      <p className={styles.meta}>
        <span className={styles.status}>{order.status}</span> · {order.id} ·{' '}
        {formatDateTime(order.created_at)}
      </p>

      <ul className={styles.items}>
        {order.order_items.map((item) => (
          <li key={item.id} className={styles.item}>
            {/* product_name and unit_price_minor are snapshots taken at purchase
                time, so this stays accurate even if the seller edits the product. */}
            <span className={styles.itemName}>{item.product_name}</span>
            <span className={styles.itemMeta}>
              {item.quantity} ×{' '}
              {formatMoney(item.unit_price_minor, order.currency)}
            </span>
            <span className={styles.itemSubtotal}>
              {formatMoney(item.subtotal_minor, order.currency)}
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.total}>
        <span>Total</span>
        <span>{formatMoney(order.total_minor, order.currency)}</span>
      </p>
    </main>
  );
}

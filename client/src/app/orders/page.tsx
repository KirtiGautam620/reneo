'use client';

import Link from 'next/link';
import { useOrders } from '@/hooks/use-orders';
import { useSession } from '@/hooks/use-session';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import styles from './orders.module.css';

export default function OrdersPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const { data, isPending, isError, error } = useOrders();

  if (!sessionLoading && !user) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Orders</h1>
        <p className={styles.notice}>
          <Link href="/login" className={styles.noticeLink}>
            Log in
          </Link>{' '}
          to see your orders.
        </p>
      </main>
    );
  }

  const orders = data?.data ?? [];

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Orders</h1>

      {isPending && <p className={styles.notice}>Loading orders…</p>}

      {isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error instanceof ApiError ? error.message : 'Could not load your orders.'}
        </p>
      )}

      {!isPending && !isError && orders.length === 0 && (
        <p className={styles.notice}>
          No orders yet.{' '}
          <Link href="/" className={styles.noticeLink}>
            Browse the catalogue
          </Link>
          .
        </p>
      )}

      {orders.length > 0 && (
        <ul className={styles.items}>
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/orders/${order.id}`} className={styles.orderLink}>
                <span className={styles.orderId}>
                  {order.order_items.length} item
                  {order.order_items.length === 1 ? '' : 's'} ·{' '}
                  {formatDateTime(order.created_at)}
                </span>
                <span className={styles.itemMeta}>{order.status}</span>
                <span className={styles.itemSubtotal}>
                  {formatMoney(order.total_minor, order.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

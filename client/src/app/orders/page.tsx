'use client';

import Link from 'next/link';
import { useOrders } from '@/hooks/use-orders';
import { useSession } from '@/hooks/use-session';
import { Skeleton, SkeletonRegion } from '@/components/skeleton/Skeleton';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { Order, OrderStatus } from '@/types/api';
import styles from './orders.module.css';

const STATUS_CLASS: Record<OrderStatus, string> = {
  CONFIRMED: styles.statusConfirmed,
  CANCELLED: styles.statusCancelled,
  PENDING: styles.statusPending,
};

/** Units bought, not line count — two of one product is two items. */
const itemCount = (order: Order) =>
  order.order_items.reduce((sum, item) => sum + item.quantity, 0);

export default function OrdersPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const { data, isPending, isError, error } = useOrders();

  if (!sessionLoading && !user) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Your orders</h1>
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
      <h1 className={styles.heading}>Your orders</h1>
      <p className={styles.subheading}>Most recent first.</p>

      {isPending && (
        <SkeletonRegion label="Loading orders">
          <ul className={styles.list}>
            {Array.from({ length: 4 }, (_, index) => (
              <li key={index}>
                <span className={styles.row}>
                  <span className={styles.rowMain}>
                    <Skeleton width="45%" height={20} />
                    <Skeleton width="70%" height={15} />
                  </span>
                  <Skeleton width={86} height={19} rounded />
                  <Skeleton width={56} height={17} />
                  <span className={styles.rowTotal}>
                    <Skeleton width="100%" height={19} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </SkeletonRegion>
      )}

      {isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error instanceof ApiError ? error.message : 'Could not load your orders.'}
        </p>
      )}

      {!isPending && !isError && orders.length === 0 && (
        <div className={styles.notice}>
          <p>You have not placed any orders yet.</p>
          <Link href="/" className={styles.emptyAction}>
            Browse the marketplace
          </Link>
        </div>
      )}

      {orders.length > 0 && (
        <ul className={styles.list}>
          {orders.map((order) => {
            const count = itemCount(order);
            return (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowDate}>
                      {formatDateTime(order.created_at)}
                    </span>
                    <span className={styles.rowId}>{order.id}</span>
                  </span>
                  <span className={`${styles.status} ${STATUS_CLASS[order.status]}`}>
                    {order.status}
                  </span>
                  <span className={styles.rowCount}>
                    {count} item{count === 1 ? '' : 's'}
                  </span>
                  <span className={styles.rowTotal}>
                    {formatMoney(order.total_minor, order.currency)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

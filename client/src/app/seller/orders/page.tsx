'use client';

import Link from 'next/link';
import { useOrders } from '@/hooks/use-orders';
import { describeSellerError } from '@/lib/seller-errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import styles from '../seller.module.css';

export default function SellerOrdersPage() {
  const { data, isPending, isError, error } = useOrders();
  const orders = data?.data ?? [];

  return (
    <main className={styles.page}>
      <Link href="/seller" className={styles.back}>
        ← Your store
      </Link>

      <h1 className={styles.heading}>Orders</h1>
      <p className={styles.subheading}>
        Orders containing at least one of your products. RLS limits the line
        items to yours, so another seller&apos;s items in the same order are not
        shown.
      </p>

      {isPending && <p className={styles.notice}>Loading orders…</p>}

      {isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(error)}
        </p>
      )}

      {!isPending && !isError && orders.length === 0 && (
        <p className={styles.notice}>No orders yet.</p>
      )}

      {orders.map((order) => {
        // An order may span several sellers, so order.total_minor is the whole
        // basket. Only the visible line items are this seller's.
        const yourTotal = order.order_items.reduce(
          (sum, item) => sum + item.subtotal_minor,
          0
        );
        const spansOtherSellers = yourTotal !== order.total_minor;

        return (
          <section key={order.id} className={styles.section}>
            <div className={styles.header}>
              <div>
                <h2 className={styles.sectionTitle}>
                  {formatDateTime(order.created_at)}
                </h2>
                <p className={styles.rowMeta}>
                  <span className={styles.badge}>{order.status}</span> {order.id}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p className={styles.rowPrice}>
                  {formatMoney(yourTotal, order.currency)}
                </p>
                <p className={styles.hint}>
                  {spansOtherSellers
                    ? `your items · ${formatMoney(order.total_minor, order.currency)} order total`
                    : 'your items'}
                </p>
              </div>
            </div>

            <ul className={styles.list}>
              {order.order_items.map((item) => (
                <li key={item.id} className={styles.listRow}>
                  <span className={styles.rowMain}>
                    {/* A purchase-time snapshot: later catalogue edits do not
                        rewrite what was actually sold. */}
                    <span className={styles.rowName}>{item.product_name}</span>
                    <span className={styles.rowMeta}>
                      {item.quantity} ×{' '}
                      {formatMoney(item.unit_price_minor, order.currency)}
                    </span>
                  </span>
                  <span className={styles.rowPrice}>
                    {formatMoney(item.subtotal_minor, order.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useOrders } from '@/hooks/use-orders';
import { useSession } from '@/hooks/use-session';
import { describeSellerError } from '@/lib/seller-errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { OrderRef } from '@/components/order/OrderRef';
import { Skeleton, SkeletonRegion } from '@/components/skeleton/Skeleton';
import { EmptyState } from '@/components/panel/EmptyState';
import { ReceiptIcon } from '@/components/panel/icons';
import type { Order, OrderItem, OrderStatus } from '@/types/api';
import styles from './orders.module.css';

const STATUS_CLASS: Record<OrderStatus, string> = {
  CONFIRMED: styles.statusConfirmed,
  CANCELLED: styles.statusCancelled,
  PENDING: styles.statusPending,
};

/**
 * Scoping — verified against the running API with a two-seller order:
 *
 *   FILTERING OF LINE ITEMS IS DONE SERVER-SIDE, BY ROW LEVEL SECURITY.
 *
 * `GET /orders` applies no filter of its own. The `orders_select_as_seller`
 * policy returns orders containing at least one of the caller's line items, and
 * `order_items_select_as_seller` (`seller_id = auth.uid()`) trims the embedded
 * items to the caller's own. A seller literally never receives another seller's
 * line items over the wire.
 *
 * What RLS does *not* do is redact `orders.total_minor`. It is a column on a row
 * the seller may legitimately read, so it arrives intact — and on a basket
 * spanning two sellers it is the combined figure (110 000 when this seller sold
 * only 50 000 of it). Rendering it would disclose another seller's revenue, so
 * this page never shows it. The subtotal below is summed from the line items
 * this seller actually owns.
 */
function sellerSubtotal(items: OrderItem[]): number {
  // subtotal_minor is a generated column: unit_price_minor × quantity.
  return items.reduce((sum, item) => sum + item.subtotal_minor, 0);
}

function OrderCard({ order, items }: { order: Order; items: OrderItem[] }) {
  return (
    <section className={styles.order}>
      <header className={styles.orderHead}>
        <span className={styles.orderDate}>{formatDateTime(order.created_at)}</span>
        <span className={`${styles.status} ${STATUS_CLASS[order.status]}`}>
          {order.status}
        </span>
        <span className={styles.orderId}>
          <OrderRef id={order.id} />
        </span>
      </header>

      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            {/*
              product_name and unit_price_minor are snapshots taken at purchase
              time. They are rendered exactly as stored — never re-read from the
              current product — so repricing or renaming an item today cannot
              rewrite what a buyer was charged months ago.
            */}
            <span className={styles.itemName}>{item.product_name}</span>
            <span className={styles.itemUnit}>
              {item.quantity} × {formatMoney(item.unit_price_minor, order.currency)}
            </span>
            <span className={styles.itemSubtotal}>
              {formatMoney(item.subtotal_minor, order.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.subtotal}>
        <span className={styles.subtotalLabel}>
          Your subtotal
          <span className={styles.subtotalHint}>
            Your line items only. An order may include other sellers.
          </span>
        </span>
        <span className={styles.subtotalValue}>
          {formatMoney(sellerSubtotal(items), order.currency)}
        </span>
      </div>
    </section>
  );
}

export default function SellerOrdersPage() {
  const { user } = useSession();
  const { data, isPending, isError, error } = useOrders();

  const orders = data?.data ?? [];
  const sellerId = user?.id ?? null;

  const visible = orders
    .map((order) => ({
      order,
      /*
       * RLS has already restricted these to this seller. Re-checking seller_id
       * is defence in depth, not the mechanism: showing another seller's line
       * would disclose their revenue, so it is worth the extra comparison. When
       * the session has not resolved yet, the server's own scoping stands.
       */
      items: sellerId
        ? order.order_items.filter((item) => item.seller_id === sellerId)
        : order.order_items,
    }))
    // An order with no items of ours should not be reachable, but an empty card
    // would be meaningless if it were.
    .filter(({ items }) => items.length > 0);

  return (
    <main className={styles.page}>
      <Link href="/seller" className={styles.back}>
        ← Your store
      </Link>

      <h1 className={styles.heading}>Incoming orders</h1>
      <p className={styles.subheading}>
        Orders containing at least one of your products, showing your line items
        and what they earned. An order can span several sellers, so the buyer&apos;s
        overall order total is not shown here.
      </p>

      {isPending && (
        <SkeletonRegion label="Loading orders">
          {Array.from({ length: 2 }, (_, index) => (
            <section key={index} className={styles.order}>
              <header className={styles.orderHead}>
                <Skeleton width={170} height={20} />
                <Skeleton width={86} height={19} rounded />
              </header>
              <ul className={styles.items}>
                {Array.from({ length: 2 }, (_, row) => (
                  <li key={row} className={styles.item}>
                    <span className={styles.itemName}>
                      <Skeleton width="60%" height={20} />
                    </span>
                    <Skeleton width={110} height={17} />
                    <span className={styles.itemSubtotal}>
                      <Skeleton width="100%" height={19} />
                    </span>
                  </li>
                ))}
              </ul>
              <div className={styles.subtotal}>
                <Skeleton width={150} height={32} />
                <Skeleton width={110} height={22} />
              </div>
            </section>
          ))}
        </SkeletonRegion>
      )}

      {isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(error)}
        </p>
      )}

      {!isPending && !isError && visible.length === 0 && (
        <EmptyState
          icon={<ReceiptIcon />}
          title="No orders yet"
          body="As soon as a customer buys one of your products, the order appears here with your line items."
          action={{ label: 'Review your products', href: '/seller/products' }}
        />
      )}

      {visible.map(({ order, items }) => (
        <OrderCard key={order.id} order={order} items={items} />
      ))}
    </main>
  );
}

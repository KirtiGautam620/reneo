'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/hooks/use-cart';
import { useCartProducts } from '@/hooks/use-products';
import { useCheckout } from '@/hooks/use-checkout';
import { useSession } from '@/hooks/use-session';
import { formatMoney } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import type { ProductWithInventory } from '@/types/api';
import styles from './page.module.css';

export default function CartPage() {
  const router = useRouter();
  const { user, role, isLoading: sessionLoading } = useSession();
  const { items, updateQuantity, removeItem, clear, itemCount } = useCart();
  const { checkout, isPending, problem, reset, invalidateAfterOrder } = useCheckout();

  const productIds = useMemo(() => items.map((item) => item.product_id), [items]);
  const results = useCartProducts(productIds);

  /**
   * Line items pair the stored { product_id, quantity } with the product as the
   * server currently describes it. Nothing about price or name is read from
   * localStorage — it is fetched fresh every time.
   */
  const lines = items.map((item, index) => {
    const result = results[index];
    return {
      item,
      product: result?.data as ProductWithInventory | undefined,
      isLoading: result?.isPending ?? true,
      error: result?.error,
    };
  });

  const productName = useCallback(
    (id: string) =>
      (results.find((result) => result.data?.id === id)?.data as
        | ProductWithInventory
        | undefined)?.name,
    [results]
  );

  const isLoadingProducts = lines.some((line) => line.isLoading);

  const total = lines.reduce(
    (sum, line) =>
      line.product ? sum + line.product.price_minor * line.item.quantity : sum,
    0
  );
  const currency = lines.find((line) => line.product)?.product?.currency ?? 'XOF';

  // Stock shown here is a hint that can go stale at any moment; the server
  // re-checks it inside the order transaction. Blocking obviously-doomed
  // submissions just saves a round trip.
  const hasBlockingLine = lines.some((line) => {
    if (line.error) return true;
    if (!line.product) return false;
    return (
      line.product.status !== 'ACTIVE' ||
      line.item.quantity > line.product.inventory.quantity
    );
  });

  const isCustomer = role === 'CUSTOMER';
  const canCheckout =
    items.length > 0 &&
    !isLoadingProducts &&
    !hasBlockingLine &&
    !isPending &&
    isCustomer;

  async function handleCheckout() {
    try {
      const result = await checkout({ items, productName });

      // Order committed: drop the local cart, refresh every product query so
      // stock counts reflect what this order just took, then show the order.
      clear();
      await invalidateAfterOrder();
      router.push(`/orders/${result.order_id}`);
    } catch {
      // Already classified by code into `problem`; nothing to add here.
    }
  }

  if (!sessionLoading && !user) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Your cart</h1>
        <p className={styles.notice}>
          <Link href="/login" className={styles.noticeLink}>
            Log in
          </Link>{' '}
          to see your cart and check out. Your cart is stored on this device and
          will still be here.
        </p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Your cart</h1>
        <p className={styles.notice}>
          Your cart is empty.{' '}
          <Link href="/" className={styles.noticeLink}>
            Browse the catalogue
          </Link>
          .
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>
        Your cart{itemCount > 0 ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}
      </h1>

      <ul className={styles.items}>
        {lines.map(({ item, product, isLoading, error }) => {
          const blockedByServer = problem?.productId === item.product_id;
          const gone = error instanceof ApiError && error.status === 404;
          const archived = product ? product.status !== 'ACTIVE' : false;
          const available = product?.inventory.quantity ?? 0;
          const exceedsStock = Boolean(product) && item.quantity > available;

          return (
            <li
              key={item.product_id}
              className={`${styles.item} ${
                blockedByServer || gone || archived || exceedsStock
                  ? styles.itemBlocked
                  : ''
              }`}
            >
              <div className={styles.itemInfo}>
                {isLoading && <span className={styles.itemName}>Loading…</span>}

                {!isLoading && !product && (
                  <span className={styles.itemName}>
                    {gone ? 'Product no longer available' : 'Could not load this product'}
                  </span>
                )}

                {product && (
                  <>
                    <Link
                      href={`/products/${product.id}`}
                      className={styles.itemName}
                    >
                      {product.name}
                    </Link>
                    <p className={styles.itemMeta}>
                      {formatMoney(product.price_minor, product.currency)} each ·{' '}
                      {available > 0 ? `${available} in stock` : 'sold out'}
                    </p>
                  </>
                )}

                {archived && (
                  <p className={styles.itemWarning}>
                    Withdrawn by the seller — remove it to check out.
                  </p>
                )}

                {!archived && exceedsStock && (
                  <p className={styles.itemWarning}>
                    Only {available} left. Lower the quantity to continue.
                  </p>
                )}

                {gone && (
                  <p className={styles.itemWarning}>
                    Remove it to check out.
                  </p>
                )}
              </div>

              <input
                className={`${styles.quantity} ${
                  exceedsStock ? styles.quantityInvalid : ''
                }`}
                type="number"
                min={1}
                value={item.quantity}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  updateQuantity(item.product_id, Number.isFinite(next) ? next : 1);
                  // The cart changed, so the previous failure no longer applies.
                  reset();
                }}
                disabled={isPending}
                aria-label={`Quantity for ${product?.name ?? 'product'}`}
              />

              <span className={styles.subtotal}>
                {product
                  ? formatMoney(
                      product.price_minor * item.quantity,
                      product.currency
                    )
                  : '—'}
              </span>

              <button
                type="button"
                className={styles.remove}
                onClick={() => {
                  removeItem(item.product_id);
                  reset();
                }}
                disabled={isPending}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      {problem && (
        <div className={styles.problem} role="alert">
          <p className={styles.problemTitle}>{problem.title}</p>
          <p className={styles.problemDetail}>{problem.detail}</p>

          {(problem.retryable || problem.code === 'UNAUTHENTICATED') && (
            <div className={styles.problemActions}>
              {problem.retryable && (
                <button
                  type="button"
                  className={styles.problemAction}
                  onClick={() => void handleCheckout()}
                  disabled={isPending}
                >
                  {isPending ? 'Placing order…' : 'Try again'}
                </button>
              )}
              {problem.code === 'UNAUTHENTICATED' && (
                <Link href="/login" className={styles.problemAction}>
                  Log in
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {!sessionLoading && user && !isCustomer && (
        <p className={styles.notice}>
          You are signed in as a seller. Only customer accounts can place orders.
        </p>
      )}

      <div className={styles.summary}>
        <div>
          <p className={styles.total}>
            {isLoadingProducts ? 'Calculating…' : formatMoney(total, currency)}
          </p>
          <p className={styles.totalNote}>
            Indicative total. The server prices the order when it is placed.
          </p>
        </div>

        <button
          type="button"
          className={styles.checkout}
          onClick={() => void handleCheckout()}
          disabled={!canCheckout}
        >
          {isPending ? 'Placing order…' : 'Place order'}
        </button>
      </div>
    </main>
  );
}

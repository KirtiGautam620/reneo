'use client';

import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useProduct } from '@/hooks/use-products';
import { useCart } from '@/hooks/use-cart';
import { formatMoney } from '@/lib/format';
import { flyToCart } from '@/lib/motion/fly-to-cart';
import { ApiError } from '@/lib/api-client';
import styles from './page.module.css';

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: product, isPending, isError, error } = useProduct(id);
  const { items, addItem, isFull } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const inCart = items.find((item) => item.product_id === id)?.quantity ?? 0;

  if (isPending) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>Loading product…</p>
      </main>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className={styles.page}>
        <Link href="/" className={styles.back}>
          ← Marketplace
        </Link>
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {notFound
            ? 'This product does not exist, or is not visible to your account.'
            : error instanceof ApiError
              ? error.message
              : 'Could not load this product.'}
        </p>
      </main>
    );
  }

  const available = product.inventory.quantity;
  const isArchived = product.status === 'ARCHIVED';
  const canAdd = !isArchived && available > 0 && (inCart > 0 || !isFull);

  function handleAdd() {
    addItem(id, quantity);
    setJustAdded(true);

    // Send the product itself to the cart, so the count in the corner changing
    // has a visible cause.
    if (addButtonRef.current && product) {
      flyToCart(
        addButtonRef.current,
        product.name,
        formatMoney(product.price_minor * quantity, product.currency)
      );
    }
  }

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        ← Marketplace
      </Link>

      <p className={styles.category}>{product.category}</p>
      <h1 className={styles.name}>{product.name}</h1>
      <p className={styles.price}>
        {formatMoney(product.price_minor, product.currency)}
      </p>

      {product.description && (
        <p className={styles.description}>{product.description}</p>
      )}

      {isArchived ? (
        <p className={styles.archived}>
          This product has been archived by its seller and can no longer be
          ordered.
        </p>
      ) : (
        <p
          className={`${styles.stockLine} ${
            available > 0 ? styles.inStock : styles.soldOut
          }`}
        >
          {available > 0 ? `${available} in stock` : 'Sold out'}
        </p>
      )}

      <div className={styles.actions}>
        <input
          className={styles.quantity}
          type="number"
          min={1}
          // Stock is only a hint: it can change between this render and
          // checkout, where the server has the final say.
          max={Math.max(1, available)}
          value={quantity}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            setQuantity(Number.isFinite(next) && next > 0 ? next : 1);
            setJustAdded(false);
          }}
          disabled={!canAdd}
          aria-label="Quantity"
        />

        <button
          ref={addButtonRef}
          type="button"
          className={styles.add}
          onClick={handleAdd}
          disabled={!canAdd}
        >
          Add to cart
        </button>

        {justAdded && (
          <span className={styles.added} role="status">
            Added.{' '}
            <Link href="/cart" className={styles.addedLink}>
              Go to cart
            </Link>
          </span>
        )}

        {!justAdded && inCart > 0 && (
          <span className={styles.inCart}>{inCart} already in your cart</span>
        )}

        {isFull && inCart === 0 && (
          <span className={styles.inCart}>
            Your cart already holds the maximum of 50 different products.
          </span>
        )}
      </div>
    </main>
  );
}

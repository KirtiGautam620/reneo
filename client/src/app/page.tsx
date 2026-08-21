'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useProducts } from '@/hooks/use-products';
import { useSession } from '@/hooks/use-session';
import { formatMoney } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import type { ProductSort } from '@/types/api';
import styles from './page.module.css';

const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

export default function CataloguePage() {
  const { user, isLoading: sessionLoading } = useSession();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProductSort>('newest');
  const [inStockOnly, setInStockOnly] = useState(false);

  // Deferring keeps each keystroke from starting a new paginated chain.
  const q = useDeferredValue(search).trim();

  const {
    data,
    error,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useProducts({
    q: q.length > 0 ? q : undefined,
    sort,
    in_stock: inStockOnly ? true : undefined,
  });

  // Every endpoint requires a JWT, the catalogue included.
  if (!sessionLoading && !user) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Catalogue</h1>
        <p className={styles.subheading}>Browse products from every seller.</p>
        <p className={styles.notice} style={{ marginTop: 24 }}>
          The catalogue is only visible to signed-in accounts.{' '}
          <Link href="/login" className={styles.noticeLink}>
            Log in
          </Link>{' '}
          or{' '}
          <Link href="/signup" className={styles.noticeLink}>
            create an account
          </Link>{' '}
          to continue.
        </p>
      </main>
    );
  }

  const products = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Catalogue</h1>
      <p className={styles.subheading}>Browse products from every seller.</p>

      <div className={styles.filters}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search products…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search products"
        />

        <select
          className={styles.select}
          value={sort}
          onChange={(event) => setSort(event.target.value as ProductSort)}
          aria-label="Sort products"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(event) => setInStockOnly(event.target.checked)}
          />
          In stock only
        </label>
      </div>

      {isPending && <p className={styles.notice}>Loading products…</p>}

      {isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error instanceof ApiError
            ? error.message
            : 'Could not load the catalogue.'}
        </p>
      )}

      {!isPending && !isError && products.length === 0 && (
        <p className={styles.notice}>
          No products match these filters.
        </p>
      )}

      {products.length > 0 && (
        <div className={styles.grid}>
          {products.map((product) => {
            // The list endpoint returns ProductListItem — stock is on the
            // inventory relation, never a flat `stock` field on the product.
            const quantity = product.inventory.quantity;
            return (
              <Link
                key={product.id}
                href={`/products/${product.id}`}
                className={styles.card}
              >
                <span className={styles.category}>{product.category}</span>
                <span className={styles.name}>{product.name}</span>
                {product.description && (
                  <span className={styles.description}>{product.description}</span>
                )}
                <span className={styles.cardFooter}>
                  <span className={styles.price}>
                    {formatMoney(product.price_minor, product.currency)}
                  </span>
                  <span
                    className={`${styles.stock} ${quantity === 0 ? styles.soldOut : ''}`}
                  >
                    {quantity === 0 ? 'Sold out' : `${quantity} left`}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {hasNextPage && (
        <button
          type="button"
          className={styles.more}
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </main>
  );
}

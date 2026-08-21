'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useProductCategories, useProducts } from '@/hooks/use-products';
import { useSession } from '@/hooks/use-session';
import { Skeleton, SkeletonRegion } from '@/components/skeleton/Skeleton';
import { GhostCards, SignedOutPanel } from '@/components/panel/SignedOutPanel';
import { StorefrontIcon } from '@/components/panel/icons';
import { formatMoney } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import type { ProductSort } from '@/types/api';
import styles from './page.module.css';

const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

const ALL_CATEGORIES = '';


/** Mirrors the real card exactly — same container class, so nothing moves. */
function CardSkeleton() {
  return (
    <div className={styles.card}>
      <Skeleton width="35%" height="var(--space-3)" />
      <Skeleton width="75%" height="var(--space-5)" />
      <Skeleton width="100%" height="var(--space-5)" />
      <span className={styles.cardFooter}>
        <Skeleton width="45%" height="var(--space-6)" />
        <Skeleton width="25%" height="var(--space-4)" />
      </span>
    </div>
  );
}

export default function MarketplacePage() {
  const { user, isLoading: sessionLoading } = useSession();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProductSort>('newest');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [inStockOnly, setInStockOnly] = useState(false);

  // Deferring keeps each keystroke from starting a new paginated chain.
  const q = useDeferredValue(search).trim();
  const { data: categories } = useProductCategories();

  /**
   * Every filter is part of the query object, and the query object is the query
   * key — so switching category starts its own cached chain of pages instead of
   * showing whatever the previous category had already loaded.
   */
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
    category: category === ALL_CATEGORIES ? undefined : category,
    sort,
    in_stock: inStockOnly ? true : undefined,
  });

  const hasFilters =
    q.length > 0 || category !== ALL_CATEGORIES || inStockOnly;

  function clearFilters() {
    setSearch('');
    setCategory(ALL_CATEGORIES);
    setInStockOnly(false);
  }

  // Filters and cards only exist for a signed-in caller, and the sign-in panel
  // only for a signed-out one — so show neither until the session resolves.
  if (sessionLoading) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Marketplace</h1>
        <p className={styles.subheading}>Browse products from every seller.</p>
        <SkeletonRegion label="Loading products">
          <div className={`${styles.grid} ${styles.moreSkeleton}`}>
            {Array.from({ length: 8 }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
        </SkeletonRegion>
      </main>
    );
  }

  // Every endpoint requires a JWT, the marketplace included.
  if (!user) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>Marketplace</h1>
        <p className={styles.subheading}>Browse products from every seller.</p>

        <SignedOutPanel
          icon={<StorefrontIcon />}
          title="Sign in to start browsing"
          body="Products, prices and stock are served only to signed-in accounts. Creating one takes a moment, and you can buy or sell with it."
          primary={{ href: '/signup', label: 'Create an account' }}
          secondary={{ href: '/login', label: 'Log in' }}
          note="Free to join. No card required."
          backdrop={<GhostCards />}
        />
      </main>
    );
  }

  const products = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Marketplace</h1>
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
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter by category"
        >
          <option value={ALL_CATEGORIES}>All categories</option>
          {(categories ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

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

      {isPending && (
        <SkeletonRegion label="Loading products">
          <div className={styles.grid}>
            {Array.from({ length: 8 }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
        </SkeletonRegion>
      )}

      {isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {error instanceof ApiError
            ? error.message
            : 'Could not load the marketplace.'}
        </p>
      )}

      {!isPending && !isError && products.length === 0 && (
        <div className={styles.notice}>
          {hasFilters ? (
            <>
              <p>No products match these filters.</p>
              <button
                type="button"
                className={styles.emptyAction}
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p>
                Nothing is listed yet. The marketplace fills up as sellers add
                products.
              </p>
              <Link href="/signup" className={styles.emptyAction}>
                Sell on Reneo
              </Link>
            </>
          )}
        </div>
      )}

      {products.length > 0 && (
        <div className={styles.grid}>
          {products.map((product) => {
            // Stock lives on the inventory relation, never on the product row.
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

      {/* Appending a page must not move what is already on screen, so the
          next page's placeholders render below the existing grid. */}
      {isFetchingNextPage && (
        <SkeletonRegion label="Loading more products">
          <div className={`${styles.grid} ${styles.moreSkeleton}`}>
            {Array.from({ length: 4 }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
        </SkeletonRegion>
      )}

      {hasNextPage && !isFetchingNextPage && (
        <button
          type="button"
          className={styles.more}
          onClick={() => void fetchNextPage()}
        >
          Load more
        </button>
      )}
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useSellerProducts } from '@/hooks/use-products';
import { describeSellerError } from '@/lib/seller-errors';
import { formatMoney } from '@/lib/format';
import { Skeleton, SkeletonRegion } from '@/components/skeleton/Skeleton';
import styles from '../seller.module.css';

export default function SellerProductsPage() {
  const products = useSellerProducts();
  const rows = products.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <main className={styles.page}>
      <Link href="/seller" className={styles.back}>
        ← Your store
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Products</h1>
          <p className={styles.subheading}>
            Your own catalogue, archived products included.
          </p>
        </div>
        <Link href="/seller/products/new" className={styles.primary}>
          New product
        </Link>
      </div>

      {products.isPending && (
        <SkeletonRegion label="Loading products">
          <ul className={styles.list}>
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index}>
                <span className={styles.listRow}>
                  <span className={styles.rowMain}>
                    <Skeleton width="55%" height={20} />
                    <Skeleton width="30%" height={17} />
                  </span>
                  <span className={styles.rowPrice}>
                    <Skeleton width="100%" height={19} />
                  </span>
                  <span className={styles.rowStock}>
                    <Skeleton width="100%" height={17} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </SkeletonRegion>
      )}

      {products.isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(products.error)}
        </p>
      )}

      {!products.isPending && !products.isError && rows.length === 0 && (
        <p className={styles.notice}>
          No products yet.{' '}
          <Link href="/seller/products/new" className={styles.noticeLink}>
            Add your first one
          </Link>
          .
        </p>
      )}

      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((product) => (
            <li key={product.id}>
              <Link
                href={`/seller/products/${product.id}/edit`}
                className={styles.listRow}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{product.name}</span>
                  <span className={styles.rowMeta}>
                    {product.category}
                    {/* mine=true is the only listing that can return ARCHIVED. */}
                    {product.status === 'ARCHIVED' && (
                      <>
                        {' · '}
                        <span className={`${styles.badge} ${styles.badgeArchived}`}>
                          ARCHIVED
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className={styles.rowPrice}>
                  {formatMoney(product.price_minor, product.currency)}
                </span>
                <span
                  className={`${styles.rowStock} ${
                    product.inventory.quantity === 0 ? styles.zeroStock : ''
                  }`}
                >
                  {product.inventory.quantity} in stock
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {products.hasNextPage && (
        <button
          type="button"
          className={`${styles.secondary} ${styles.stackLg}`}
          onClick={() => void products.fetchNextPage()}
          disabled={products.isFetchingNextPage}
        >
          {products.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </main>
  );
}

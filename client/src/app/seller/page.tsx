'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useStore, useCreateStore } from '@/hooks/use-store';
import { useSellerProducts } from '@/hooks/use-seller-products';
import { describeSellerError } from '@/lib/seller-errors';
import { formatMoney } from '@/lib/format';
import styles from './seller.module.css';

function CreateStore() {
  const createStore = useCreateStore();
  const [name, setName] = useState('');

  return (
    <div className={styles.narrow}>
      <h1 className={styles.heading}>Create your store</h1>
      <p className={styles.subheading}>
        A seller owns exactly one store. Products are listed under it.
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          createStore.mutate({ name: name.trim() });
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>Store name</span>
          <input
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
        </label>

        {createStore.isError && (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {describeSellerError(createStore.error)}
          </p>
        )}

        <div>
          <button
            type="submit"
            className={styles.primary}
            disabled={createStore.isPending || name.trim().length === 0}
          >
            {createStore.isPending ? 'Creating…' : 'Create store'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function SellerDashboard() {
  const { data: store, isPending: storePending, isError, error } = useStore();
  const products = useSellerProducts();

  if (storePending) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>Loading your store…</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className={styles.page}>
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(error)}
        </p>
      </main>
    );
  }

  // GET /stores/me resolves to null when the seller has not created one yet.
  if (!store) {
    return (
      <main className={styles.page}>
        <CreateStore />
      </main>
    );
  }

  const rows = products.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>{store.name}</h1>
          <p className={styles.subheading}>Your catalogue and orders.</p>
        </div>
        <Link href="/seller/products/new" className={styles.primary}>
          New product
        </Link>
      </div>

      <div className={styles.tabs}>
        <Link href="/seller/orders" className={styles.tab}>
          Orders →
        </Link>
      </div>

      {products.isPending && <p className={styles.notice}>Loading products…</p>}

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
                href={`/seller/products/${product.id}`}
                className={styles.listRow}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{product.name}</span>
                  <span className={styles.rowMeta}>
                    {product.category}
                    {/* mine=true is the only view that can return ARCHIVED. */}
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
          className={styles.secondary}
          style={{ marginTop: 20 }}
          onClick={() => void products.fetchNextPage()}
          disabled={products.isFetchingNextPage}
        >
          {products.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </main>
  );
}

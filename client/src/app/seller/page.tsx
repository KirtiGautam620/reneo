'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api-client';
import { useCreateStore, useMyStore } from '@/hooks/use-store';
import { describeSellerError } from '@/lib/seller-errors';
import { formatDateTime } from '@/lib/format';
import type { Store } from '@/types/api';
import styles from './seller.module.css';

function CreateStoreForm() {
  const createStore = useCreateStore();
  const [name, setName] = useState('');

  const trimmed = name.trim();
  // A seller may own exactly one store. The form is only mounted when the query
  // has confirmed there is none, and submitting is blocked while the request is
  // in flight — so a second store cannot be attempted from the UI at all.
  const canSubmit = trimmed.length > 0 && !createStore.isPending;

  const staleView =
    createStore.error instanceof ApiError && createStore.error.code === 'CONFLICT';

  return (
    <div className={styles.narrow}>
      <h1 className={styles.heading}>Create your store</h1>
      <p className={styles.subheading}>
        Every seller has exactly one store. Your products are listed under it.
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          createStore.mutate({ name: trimmed });
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
            autoFocus
          />
          <span className={styles.hint}>Up to 200 characters.</span>
        </label>

        {staleView ? (
          /*
           * The server rejected a second store, so one already exists and this
           * view was out of date. The hook has already asked for a refetch; this
           * page will swap itself for the dashboard when it arrives.
           */
          <p className={styles.notice} role="status">
            You already have a store — loading it now.
          </p>
        ) : (
          createStore.isError && (
            <p className={`${styles.notice} ${styles.error}`} role="alert">
              {describeSellerError(createStore.error)}
            </p>
          )
        )}

        <div>
          <button type="submit" className={styles.primary} disabled={!canSubmit}>
            {createStore.isPending ? 'Creating…' : 'Create store'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Dashboard({ store }: { store: Store }) {
  return (
    <>
      <h1 className={styles.heading}>{store.name}</h1>
      <p className={styles.storeMeta}>
        Store opened {formatDateTime(store.created_at)}
      </p>

      <div className={styles.cards}>
        <Link href="/seller/products" className={styles.card}>
          <span className={styles.cardTitle}>Products →</span>
          <span className={styles.cardHint}>
            Add products, edit prices, restock and archive.
          </span>
        </Link>

        <Link href="/seller/orders" className={styles.card}>
          <span className={styles.cardTitle}>Orders →</span>
          <span className={styles.cardHint}>
            Orders containing your products, with your line items.
          </span>
        </Link>
      </div>
    </>
  );
}

export default function SellerHomePage() {
  const { store, needsStore, isPending, isError, error } = useMyStore();

  if (isPending) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>Loading your store…</p>
      </main>
    );
  }

  // A failed request is not the same as having no store, and must not be
  // mistaken for one — offering the create form here would invite a duplicate.
  if (isError) {
    return (
      <main className={styles.page}>
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(error)}
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {needsStore ? <CreateStoreForm /> : store && <Dashboard store={store} />}
    </main>
  );
}

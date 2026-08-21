'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduct } from '@/hooks/use-products';
import {
  useAdjustInventory,
  useArchiveProduct,
  useUpdateProduct,
} from '@/hooks/use-seller-products';
import { describeSellerError } from '@/lib/seller-errors';
import { formatMoney, toMinorUnits } from '@/lib/format';
import type { ProductWithInventory, UpdateProductRequest } from '@/types/api';
import styles from '../../seller.module.css';

/**
 * Form state is seeded from the product through useState initialisers, and the
 * parent keys this component on `updated_at` — so a successful save remounts it
 * against server truth instead of syncing fields in an effect.
 */
function ProductDetailsForm({ product }: { product: ProductWithInventory }) {
  const updateProduct = useUpdateProduct(product.id);

  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [category, setCategory] = useState(product.category);
  const [price, setPrice] = useState(String(product.price_minor));
  const [saved, setSaved] = useState(false);

  const priceMinor = toMinorUnits(price, product.currency);

  /**
   * PATCH requires at least one field and rejects unknown keys, so only what
   * actually changed is sent.
   */
  const patch: UpdateProductRequest | null = (() => {
    if (priceMinor === null) return null;
    const next: UpdateProductRequest = {};
    if (name.trim() !== product.name) next.name = name.trim();
    if (description.trim() !== (product.description ?? ''))
      next.description = description.trim();
    if (category.trim() !== product.category) next.category = category.trim();
    if (priceMinor !== product.price_minor) next.price_minor = priceMinor;
    return Object.keys(next).length > 0 ? next : null;
  })();

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!patch) return;
        setSaved(false);
        updateProduct.mutate(patch, { onSuccess: () => setSaved(true) });
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input
          className={styles.input}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
          maxLength={200}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Description</span>
        <textarea
          className={styles.textarea}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setSaved(false);
          }}
          maxLength={2000}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Category</span>
        <input
          className={styles.input}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setSaved(false);
          }}
          maxLength={100}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Price</span>
        <input
          className={styles.input}
          type="number"
          min={0}
          step={1}
          value={price}
          onChange={(event) => {
            setPrice(event.target.value);
            setSaved(false);
          }}
        />
        <span className={styles.hint}>
          {priceMinor === null
            ? 'Enter an amount in francs.'
            : `Customers will see ${formatMoney(priceMinor, product.currency)}.`}
        </span>
      </label>

      {updateProduct.isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(updateProduct.error)}
        </p>
      )}

      {saved && (
        <p className={`${styles.notice} ${styles.success}`} role="status">
          Changes saved.
        </p>
      )}

      <div>
        <button
          type="submit"
          className={styles.primary}
          disabled={!patch || updateProduct.isPending}
        >
          {updateProduct.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function StockSection({ product }: { product: ProductWithInventory }) {
  const adjustInventory = useAdjustInventory(product.id);
  const [delta, setDelta] = useState('');

  const deltaValue = Number.parseInt(delta, 10);
  const deltaValid = Number.isInteger(deltaValue) && deltaValue !== 0;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Stock</h2>
      <p className={styles.hint} style={{ marginTop: 6 }}>
        Adjustments are relative, not absolute: an order that takes stock while
        you are typing is added to rather than overwritten. Currently{' '}
        {product.inventory.quantity} in stock.
      </p>

      <div className={styles.row} style={{ marginTop: 14 }}>
        <label className={styles.field} style={{ flex: '0 1 160px' }}>
          <span className={styles.label}>Change by</span>
          <input
            className={styles.input}
            type="number"
            step={1}
            placeholder="e.g. 10 or -2"
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
          />
        </label>

        <button
          type="button"
          className={styles.secondary}
          disabled={!deltaValid || adjustInventory.isPending}
          onClick={() =>
            adjustInventory.mutate(
              { delta: deltaValue },
              { onSuccess: () => setDelta('') }
            )
          }
        >
          {adjustInventory.isPending ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {adjustInventory.isError && (
        <p
          className={`${styles.notice} ${styles.error}`}
          role="alert"
          style={{ marginTop: 14 }}
        >
          {describeSellerError(adjustInventory.error)}
        </p>
      )}

      {adjustInventory.isSuccess && (
        <p
          className={`${styles.notice} ${styles.success}`}
          role="status"
          style={{ marginTop: 14 }}
        >
          Stock is now {adjustInventory.data.quantity}.
        </p>
      )}
    </section>
  );
}

function ArchiveSection({ product }: { product: ProductWithInventory }) {
  const router = useRouter();
  const archiveProduct = useArchiveProduct();

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Archive</h2>
      <p className={styles.hint} style={{ marginTop: 6 }}>
        Archiving hides the product from the marketplace and blocks new orders.
        It is not deleted — order history keeps referring to it.
      </p>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className={`${styles.secondary} ${styles.danger}`}
          disabled={archiveProduct.isPending}
          onClick={() =>
            archiveProduct.mutate(product.id, {
              onSuccess: () => router.push('/seller'),
            })
          }
        >
          {archiveProduct.isPending ? 'Archiving…' : 'Archive product'}
        </button>
      </div>

      {archiveProduct.isError && (
        <p
          className={`${styles.notice} ${styles.error}`}
          role="alert"
          style={{ marginTop: 14 }}
        >
          {describeSellerError(archiveProduct.error)}
        </p>
      )}
    </section>
  );
}

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // A seller can read their own ARCHIVED products, so this still resolves after
  // archiving.
  const { data: product, isPending, isError, error } = useProduct(id);

  if (isPending) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>Loading product…</p>
      </main>
    );
  }

  if (isError || !product) {
    return (
      <main className={styles.page}>
        <Link href="/seller" className={styles.back}>
          ← Your store
        </Link>
        <p className={`${styles.notice} ${styles.error}`} role="alert">
          {describeSellerError(error)}
        </p>
      </main>
    );
  }

  const isArchived = product.status === 'ARCHIVED';

  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <Link href="/seller" className={styles.back}>
        ← Your store
      </Link>

      <div className={styles.header}>
        <h1 className={styles.heading}>{product.name}</h1>
        {isArchived && (
          <span className={`${styles.badge} ${styles.badgeArchived}`}>ARCHIVED</span>
        )}
      </div>
      <p className={styles.subheading}>
        {formatMoney(product.price_minor, product.currency)} ·{' '}
        {product.inventory.quantity} in stock
      </p>

      <ProductDetailsForm
        key={`${product.id}:${product.updated_at}`}
        product={product}
      />

      <StockSection product={product} />

      {!isArchived && <ArchiveSection product={product} />}
    </main>
  );
}

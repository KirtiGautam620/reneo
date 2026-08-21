'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useAdjustInventory,
  useArchiveProduct,
  useProduct,
  useUpdateProduct,
} from '@/hooks/use-products';
import { describeSellerError, fieldErrors, hasFieldErrors } from '@/lib/seller-errors';
import { currencyStep, formatMoney, toMajorUnits, toMinorUnits } from '@/lib/format';
import type { ProductWithInventory, UpdateProductRequest } from '@/types/api';
import styles from '../../../seller.module.css';

/**
 * Details form. Fields are seeded through useState initialisers rather than an
 * effect, and the parent keys this on the product *id* only.
 *
 * Keying on `updated_at` instead would remount the form on every successful
 * save — discarding the "Changes saved" acknowledgement before it could render,
 * and overwriting whatever the seller had since typed. The diff below compares
 * against the live `product` prop, so the baseline is still current after a
 * save even though the component has not remounted.
 */
function DetailsForm({ product }: { product: ProductWithInventory }) {
  const updateProduct = useUpdateProduct(product.id);

  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [category, setCategory] = useState(product.category);
  const [price, setPrice] = useState(
    String(toMajorUnits(product.price_minor, product.currency))
  );
  const [saved, setSaved] = useState(false);

  const priceMinor = toMinorUnits(price, product.currency);
  const errors = fieldErrors(updateProduct.error);

  /**
   * PATCH requires at least one field and rejects unknown keys, so only what
   * actually changed is sent — and never `quantity`, which the endpoint refuses.
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

  const touch = () => setSaved(false);

  return (
    <form
      className={styles.form}
      noValidate
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
          className={`${styles.input} ${errors.name ? styles.inputInvalid : ''}`}
          value={name}
          onChange={(e) => { setName(e.target.value); touch(); }}
          maxLength={200}
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Description</span>
        <textarea
          className={`${styles.textarea} ${errors.description ? styles.inputInvalid : ''}`}
          value={description}
          onChange={(e) => { setDescription(e.target.value); touch(); }}
          maxLength={2000}
          aria-invalid={Boolean(errors.description)}
        />
        {errors.description && (
          <span className={styles.fieldError}>{errors.description}</span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Category</span>
        <input
          className={`${styles.input} ${errors.category ? styles.inputInvalid : ''}`}
          value={category}
          onChange={(e) => { setCategory(e.target.value); touch(); }}
          maxLength={100}
          aria-invalid={Boolean(errors.category)}
        />
        {errors.category && (
          <span className={styles.fieldError}>{errors.category}</span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Price</span>
        <input
          className={`${styles.input} ${errors.price_minor ? styles.inputInvalid : ''}`}
          type="number"
          min={0}
          step={currencyStep(product.currency)}
          value={price}
          onChange={(e) => { setPrice(e.target.value); touch(); }}
          aria-invalid={Boolean(errors.price_minor)}
        />
        <span className={styles.hint}>
          {priceMinor === null
            ? 'Enter a price.'
            : `Customers will see ${formatMoney(priceMinor, product.currency)}.`}
        </span>
        {errors.price_minor && (
          <span className={styles.fieldError}>{errors.price_minor}</span>
        )}
      </label>

      {updateProduct.isError && !hasFieldErrors(updateProduct.error) && (
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
        Stock lives on the inventory relation, not the product, and is changed by
        a relative amount — an order that takes stock while you are typing is
        added to rather than overwritten. Currently {product.inventory.quantity}{' '}
        in stock.
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
            adjustInventory.mutate({ delta: deltaValue }, { onSuccess: () => setDelta('') })
          }
        >
          {adjustInventory.isPending ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {adjustInventory.isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert" style={{ marginTop: 14 }}>
          {describeSellerError(adjustInventory.error)}
        </p>
      )}

      {adjustInventory.isSuccess && (
        <p className={`${styles.notice} ${styles.success}`} role="status" style={{ marginTop: 14 }}>
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
        {/* Soft delete: order_items references this product, so the row must
            survive or order history would be destroyed. */}
        Archiving sets the status to ARCHIVED — it hides the product from the
        marketplace and blocks new orders. Nothing is deleted, and past orders
        keep referring to it.
      </p>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className={`${styles.secondary} ${styles.danger}`}
          disabled={archiveProduct.isPending}
          onClick={() =>
            archiveProduct.mutate(product.id, {
              onSuccess: () => router.push('/seller/products'),
            })
          }
        >
          {archiveProduct.isPending ? 'Archiving…' : 'Archive product'}
        </button>
      </div>

      {archiveProduct.isError && (
        <p className={`${styles.notice} ${styles.error}`} role="alert" style={{ marginTop: 14 }}>
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
        <Link href="/seller/products" className={styles.back}>
          ← Products
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
      <Link href="/seller/products" className={styles.back}>
        ← Products
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

      <DetailsForm key={product.id} product={product} />
      <StockSection product={product} />
      {!isArchived && <ArchiveSection product={product} />}
    </main>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCreateProduct } from '@/hooks/use-products';
import { describeSellerError, fieldErrors, hasFieldErrors } from '@/lib/seller-errors';
import { currencyStep, formatMoney, toMinorUnits } from '@/lib/format';
import styles from '../../seller.module.css';

/**
 * POST /products accepts no `currency` field — the column defaults to XOF — so
 * anything created here is priced in francs. The exponent is still asked of
 * Intl rather than assumed, so this stays correct if the API ever accepts one.
 */
const CURRENCY = 'XOF';

export default function NewProductPage() {
  const router = useRouter();
  const createProduct = useCreateProduct();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('0');

  // The input is in major units; the API wants integer minor units.
  const priceMinor = toMinorUnits(price, CURRENCY);
  const quantityValue = Number.parseInt(quantity, 10);
  const quantityValid = Number.isInteger(quantityValue) && quantityValue >= 0;

  const errors = fieldErrors(createProduct.error);
  const canSubmit =
    name.trim().length > 0 &&
    category.trim().length > 0 &&
    priceMinor !== null &&
    quantityValid &&
    !createProduct.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (priceMinor === null || !quantityValid) return;

    const product = await createProduct
      .mutateAsync({
        name: name.trim(),
        // Unknown keys are rejected, and an absent description is not the same
        // as an empty string — so omit it entirely when blank.
        ...(description.trim() ? { description: description.trim() } : {}),
        category: category.trim(),
        price_minor: priceMinor,
        quantity: quantityValue,
      })
      .catch(() => null);

    if (product) router.push(`/seller/products/${product.id}/edit`);
  }

  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <Link href="/seller/products" className={styles.back}>
        ← Products
      </Link>

      <h1 className={styles.heading}>New product</h1>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={`${styles.input} ${errors.name ? styles.inputInvalid : ''}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
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
            onChange={(event) => setDescription(event.target.value)}
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
            onChange={(event) => setCategory(event.target.value)}
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
            step={currencyStep(CURRENCY)}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            aria-invalid={Boolean(errors.price_minor)}
          />
          <span className={styles.hint}>
            {priceMinor === null
              ? 'Enter a price.'
              : `Customers will see ${formatMoney(priceMinor, CURRENCY)}.`}
          </span>
          {errors.price_minor && (
            <span className={styles.fieldError}>{errors.price_minor}</span>
          )}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Initial stock</span>
          <input
            className={`${styles.input} ${errors.quantity ? styles.inputInvalid : ''}`}
            type="number"
            min={0}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={Boolean(errors.quantity)}
          />
          <span className={styles.hint}>
            Set once, here. Afterwards stock moves only through orders, or the
            restock control on the product page.
          </span>
          {errors.quantity && (
            <span className={styles.fieldError}>{errors.quantity}</span>
          )}
        </label>

        {/* Field-level messages are already beside their inputs; only show a
            general banner when the failure was not field-level. */}
        {createProduct.isError && !hasFieldErrors(createProduct.error) && (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {describeSellerError(createProduct.error)}
          </p>
        )}

        <div>
          <button type="submit" className={styles.primary} disabled={!canSubmit}>
            {createProduct.isPending ? 'Creating…' : 'Create product'}
          </button>
        </div>
      </form>
    </main>
  );
}

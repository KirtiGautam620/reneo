'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCreateProduct } from '@/hooks/use-seller-products';
import { describeSellerError } from '@/lib/seller-errors';
import { formatMoney, toMinorUnits } from '@/lib/format';
import styles from '../../seller.module.css';

/**
 * POST /products accepts no `currency` field — the column defaults to XOF — so
 * every product created here is priced in francs.
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

  const priceMinor = toMinorUnits(price, CURRENCY);
  const quantityValue = Number.parseInt(quantity, 10);
  const quantityValid = Number.isInteger(quantityValue) && quantityValue >= 0;

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
        // The API rejects unknown keys, and an empty description is better
        // omitted than sent as an empty string.
        ...(description.trim() ? { description: description.trim() } : {}),
        category: category.trim(),
        price_minor: priceMinor,
        quantity: quantityValue,
      })
      .catch(() => null);

    if (product) router.push(`/seller/products/${product.id}`);
  }

  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <Link href="/seller" className={styles.back}>
        ← Your store
      </Link>

      <h1 className={styles.heading}>New product</h1>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Description</span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Category</span>
          <input
            className={styles.input}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={100}
            required
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
            onChange={(event) => setPrice(event.target.value)}
            required
          />
          <span className={styles.hint}>
            {priceMinor === null
              ? 'Enter an amount in francs.'
              : `Customers will see ${formatMoney(priceMinor, CURRENCY)}.`}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Initial stock</span>
          <input
            className={styles.input}
            type="number"
            min={0}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
          <span className={styles.hint}>
            Stock is set once here. Afterwards it changes only through orders, or
            through the restock control on the product page.
          </span>
        </label>

        {createProduct.isError && (
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

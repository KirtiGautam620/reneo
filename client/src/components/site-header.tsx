'use client';

import Link from 'next/link';
import { useCart } from '@/hooks/use-cart';
import { useSession } from '@/hooks/use-session';
import styles from './site-header.module.css';

export function SiteHeader() {
  const { itemCount } = useCart();
  const { user, role, isLoading } = useSession();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        Reneo
      </Link>

      {!isLoading && user && role === 'SELLER' && (
        <Link href="/seller" className={styles.link}>
          Seller
        </Link>
      )}

      {!isLoading && user && (
        <Link href="/orders" className={styles.link}>
          Orders
        </Link>
      )}

      {!isLoading && !user && (
        <Link href="/login" className={styles.link}>
          Log in
        </Link>
      )}

      <Link href="/cart" className={styles.cart}>
        Cart
        {/* itemCount is 0 during server render and first paint — the cart lives
            in localStorage, which does not exist until the client takes over. */}
        {itemCount > 0 && <span className={styles.badge}>{itemCount}</span>}
      </Link>
    </header>
  );
}

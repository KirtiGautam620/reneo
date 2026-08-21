'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useCart } from '@/hooks/use-cart';
import { useSession } from '@/hooks/use-session';
import styles from './Header.module.css';

function CartIcon() {
  return (
    <svg className={styles.cartIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.55L20.5 8H6.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function Header() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { itemCount } = useCart();
  const { user, role, profile, isLoading } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();

      /**
       * Every cached query — the profile, orders, the seller's own catalogue —
       * belongs to the account that fetched it. React Query keys them by id but
       * not by identity, so without a clear the next person to log in on this
       * browser reads the previous user's data straight out of the cache before
       * any refetch lands.
       */
      queryClient.clear();

      router.push('/');
    } finally {
      setSigningOut(false);
    }
  }

  const displayName = profile?.full_name?.trim() || user?.email || null;

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        Reneo
      </Link>

      <nav className={styles.nav}>
        <Link href="/" className={styles.link}>
          Marketplace
        </Link>

        {/*
          Auth and role state is unknown until the session resolves. Rendering a
          guess here would flash "Log in" at a signed-in user, or hide the seller
          link from a seller, on every page load.
        */}
        {isLoading ? (
          <span className={styles.authPlaceholder} aria-hidden="true" />
        ) : user ? (
          <>
            {role === 'SELLER' && (
              <Link href="/seller" className={styles.link}>
                Seller
              </Link>
            )}
            <Link href="/orders" className={styles.link}>
              Orders
            </Link>
            {displayName && (
              <span className={styles.user} title={displayName}>
                {displayName}
              </span>
            )}
            <button
              type="button"
              className={styles.logout}
              onClick={() => void handleLogout()}
              disabled={signingOut}
            >
              {signingOut ? 'Logging out…' : 'Log out'}
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className={styles.link}>
              Log in
            </Link>
            <Link href="/signup" className={styles.signup}>
              Sign up
            </Link>
          </>
        )}
      </nav>

      <Link
        href="/cart"
        className={styles.cart}
        aria-label={
          itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart, empty'
        }
      >
        <CartIcon />
        Cart
        {/* Zero during server render and first paint — the cart lives in
            localStorage, which does not exist until the client takes over. */}
        {itemCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {itemCount}
          </span>
        )}
      </Link>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { ApiError } from '@/lib/api-client';
import styles from './status.module.css';

/**
 * Route-level error boundary. App Router mounts this automatically when a route
 * segment throws during render.
 *
 * As everywhere else, an API failure is described by its `code` — never by
 * matching on message text, which is prose the contract does not guarantee.
 */
function describe(error: Error): { title: string; detail: string; showLogin: boolean } {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'UNAUTHENTICATED':
        return {
          title: 'Your session expired',
          detail: 'Log in again to pick up where you left off.',
          showLogin: true,
        };
      case 'FORBIDDEN':
      case 'NOT_A_CUSTOMER':
        return {
          title: 'Not allowed',
          detail: 'This account does not have access to that page.',
          showLogin: false,
        };
      case 'NOT_FOUND':
        return {
          title: 'Not found',
          detail: 'That item no longer exists, or was never visible to you.',
          showLogin: false,
        };
      case 'INTERNAL_ERROR':
        return {
          title: 'Something went wrong on our side',
          detail: 'The request did not complete. Trying again is safe.',
          showLogin: false,
        };
      default:
        return {
          title: 'Something went wrong',
          detail: error.message,
          showLogin: false,
        };
    }
  }

  return {
    title: 'Something went wrong',
    detail: 'This page failed to load. Trying again usually fixes it.',
    showLogin: false,
  };
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { title, detail, showLogin } = describe(error);

  return (
    <main className={styles.page}>
      <p className={styles.code}>ERROR</p>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.detail}>{detail}</p>

      <div className={styles.actions}>
        {/* reset() re-renders the segment without a full page reload. */}
        <button type="button" className={styles.primary} onClick={reset}>
          Try again
        </button>
        {showLogin ? (
          <Link href="/login" className={styles.secondary}>
            Log in
          </Link>
        ) : (
          <Link href="/" className={styles.secondary}>
            Marketplace
          </Link>
        )}
      </div>

      {/* Next replaces the message in production builds; the digest is the
          handle for finding this exact error in the server logs. */}
      {error.digest && <p className={styles.digest}>Reference: {error.digest}</p>}
    </main>
  );
}

'use client';

import { useState } from 'react';
import { orderReference } from '@/lib/format';
import styles from './OrderRef.module.css';

/**
 * Copyable order reference. Shows the short code, copies the full id — the
 * value someone actually needs to paste into a support message.
 */
export function OrderRef({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the full id is still in the title
      // attribute, so it stays selectable by hand.
    }
  }

  return (
    <button
      type="button"
      className={styles.ref}
      onClick={() => void copy()}
      title={id}
      aria-label={`Order reference ${orderReference(id)}. Copy the full order id.`}
    >
      <span className={styles.label}>Ref</span>
      <span className={styles.code}>{orderReference(id)}</span>
      <span className={`${styles.action} ${copied ? styles.copied : ''}`}>
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

/** Non-interactive variant, for rows that are themselves links. */
export function OrderRefStatic({ id }: { id: string }) {
  return (
    <span className={styles.static} title={id}>
      <span className={styles.label}>Ref</span>
      <span className={styles.code}>{orderReference(id)}</span>
    </span>
  );
}

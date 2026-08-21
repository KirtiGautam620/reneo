import Link from 'next/link';
import styles from './SignedOutPanel.module.css';

type Action = { href: string; label: string };

/**
 * Shared signed-out state.
 *
 * `backdrop` renders behind the panel and is decorative only — see
 * `GhostCards` / `GhostRows`, which draw empty shapes and never fabricate
 * product or order data for someone who cannot yet see any.
 */
export function SignedOutPanel({
  icon,
  title,
  body,
  primary,
  secondary,
  note,
  backdrop,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  primary: Action;
  secondary?: Action;
  note?: string;
  backdrop?: React.ReactNode;
}) {
  return (
    <section className={styles.wrap}>
      {backdrop && (
        <div className={styles.backdrop} aria-hidden="true">
          {backdrop}
        </div>
      )}

      <div className={`${styles.panel} ${backdrop ? '' : styles.panelFlush}`}>
        <span className={styles.badge} aria-hidden="true">
          {icon}
        </span>

        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>

        <div className={styles.actions}>
          <Link href={primary.href} className={styles.primary}>
            {primary.label}
          </Link>
          {secondary && (
            <Link href={secondary.href} className={styles.secondary}>
              {secondary.label}
            </Link>
          )}
        </div>

        {note && <p className={styles.note}>{note}</p>}
      </div>
    </section>
  );
}

export function GhostCards({ count = 12 }: { count?: number }) {
  return (
    <div className={styles.ghostGrid}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={styles.ghost} />
      ))}
    </div>
  );
}

export function GhostRows({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.ghostRows}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={styles.ghost} />
      ))}
    </div>
  );
}

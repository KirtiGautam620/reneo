import Link from 'next/link';
import styles from './SignedOutPanel.module.css';

/**
 * The empty state for any list.
 *
 * Shares the signed-out panel's visual language, because both answer the same
 * question — "there is nothing here, now what?" — and both deserve a better
 * answer than a grey box. Every empty state carries exactly one clear action,
 * which is why `action` is a single value rather than a list.
 *
 * The action may navigate (`href`) or do something in place (`onClick`), such
 * as clearing a filter, so the caller supplies whichever fits and the right
 * element is rendered.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  /** Sits inside an already-padded page, so the outer spacing is reduced. */
  compact?: boolean;
}) {
  return (
    <div className={`${styles.panel} ${compact ? styles.panelFlush : ''}`}>
      <span className={styles.badge} aria-hidden="true">
        {icon}
      </span>

      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>

      {action && (
        <div className={styles.actions}>
          {action.href ? (
            <Link href={action.href} className={styles.primary}>
              {action.label}
            </Link>
          ) : (
            <button type="button" className={styles.primary} onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

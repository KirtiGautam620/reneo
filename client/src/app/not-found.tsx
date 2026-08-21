import Link from 'next/link';
import styles from './status.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.detail}>
        That page does not exist. It may have moved, or the link may be wrong.
      </p>
      <div className={styles.actions}>
        <Link href="/" className={styles.primary}>
          Back to the marketplace
        </Link>
      </div>
    </main>
  );
}

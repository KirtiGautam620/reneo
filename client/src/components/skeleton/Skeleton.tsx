import styles from './Skeleton.module.css';

/**
 * A placeholder block.
 *
 * It carries no layout of its own beyond the width and height it is given —
 * the caller renders it *inside the real component's own container classes*,
 * so padding, gaps and borders come from the finished layout rather than being
 * approximated here. That is what keeps data landing without a shift.
 *
 * `height` should match the line-height of the text it stands in for, not the
 * font size.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  rounded = false,
  className,
}: {
  width?: number | string;
  height?: number | string;
  rounded?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.block} ${rounded ? styles.pill : ''} ${className ?? ''}`}
      style={{ width, height }}
    />
  );
}

/** Marks a loading region for assistive tech without announcing every block. */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

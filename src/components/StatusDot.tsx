import styles from './StatusDot.module.css'

export default function StatusDot({ label }: { label?: string }) {
  return (
    <span className={styles.wrap} role="status">
      <span className={styles.dot} aria-hidden="true" />
      {label ? <span className={styles.label}>{label}</span> : null}
    </span>
  )
}

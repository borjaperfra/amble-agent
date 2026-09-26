import Symbol from './Symbol'
import styles from './StatusDot.module.css'

// The Rep at work: its eye, breathing. The iris is the same moss dot the
// listening indicator always was (DESIGN_SYSTEM §22), now inside the symbol.
export default function StatusDot({ label }: { label?: string }) {
  return (
    <span className={styles.wrap} role="status">
      <Symbol size={label ? 28 : 24} breathe />
      {label ? <span className={styles.label}>{label}</span> : null}
    </span>
  )
}

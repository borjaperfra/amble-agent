'use client'

import Link from 'next/link'
import { useI18n } from '@/components/I18nProvider'
import { postJson } from '@/components/api'
import type { AdminFeedbackItem } from '@/lib/admin/feedback-triage'
import { adminDictionaries } from '@/lib/i18n/dictionaries/admin'
import styles from '@/app/admin/admin.module.css'

// Feedback as the owner reads it: how much it matters (weight, not colour),
// what kind it is, one line on what it is about, then the words themselves
// and who sent them.
export default function AdminFeedbackList({
  items,
  onChange,
  linkPeople = true,
}: {
  items: AdminFeedbackItem[]
  onChange: (items: AdminFeedbackItem[]) => void
  linkPeople?: boolean
}) {
  const { locale } = useI18n()
  const a = adminDictionaries[locale].feedback
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  async function toggle(item: AdminFeedbackItem) {
    const seen = !item.seen_at
    onChange(items.map((entry) => (entry.id === item.id ? { ...entry, seen_at: seen ? new Date().toISOString() : null } : entry)))
    await postJson('/api/admin/feedback', { action: 'seen', id: item.id, seen })
  }

  return (
    <ul className={styles.feed}>
      {items.map((item) => (
        <li key={item.id} className={item.seen_at ? `${styles.item} ${styles.seen}` : styles.item}>
          <div className={styles.itemHead}>
            {item.importance !== null ? (
              <span className={styles.dots} role="img" aria-label={a.importance(item.importance)} title={a.importance(item.importance)}>
                {'●'.repeat(item.importance)}
                {'○'.repeat(5 - item.importance)}
              </span>
            ) : (
              <span className={styles.kind}>{a.unsorted}</span>
            )}
            {item.kind && (
              <span className={item.kind === 'blocking_bug' ? `${styles.kind} ${styles.kindBlocking}` : styles.kind}>{a.kinds[item.kind]}</span>
            )}
            {item.suspicious && <span className={styles.flag}>{a.suspicious}</span>}
          </div>
          {item.summary && <p className={styles.summary}>{item.summary}</p>}
          <p className={styles.text}>{item.message}</p>
          <p className={styles.meta}>
            {linkPeople ? (
              <Link href={`/admin/people/${encodeURIComponent(item.candidate_id)}`}>{item.name ?? item.email ?? item.candidate_id}</Link>
            ) : (
              <span>{item.name ?? item.email ?? item.candidate_id}</span>
            )}
            {item.email && <a href={`mailto:${item.email}`}>{item.email}</a>}
            <span>{a.channels[item.channel] ?? item.channel}</span>
            {item.page && (
              <span>
                {a.screen}: {item.page}
              </span>
            )}
            <span>{date.format(new Date(item.created_at))}</span>
          </p>
          <button type="button" className="text-btn" onClick={() => void toggle(item)}>
            {item.seen_at ? a.markUnread : a.markSeen}
          </button>
        </li>
      ))}
    </ul>
  )
}

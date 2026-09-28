'use client'

import { useState } from 'react'
import Header from '@/components/Header'
import { useI18n } from '@/components/I18nProvider'
import type { FeedbackListing } from '@/lib/feedback'
import styles from '@/app/feedback/feedback.module.css'

export default function FeedbackList({ items: initial }: { items: FeedbackListing[] }) {
  const { t, locale } = useI18n()
  const f = t.feedback
  const [items, setItems] = useState(initial)
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const unread = items.filter((item) => !item.seen_at).length

  async function toggle(item: FeedbackListing) {
    const seen = !item.seen_at
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, seen_at: seen ? new Date().toISOString() : null } : entry)))
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seen', id: item.id, seen }),
    }).catch(() => undefined)
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{f.pageTitle}</h1>
        <p className={styles.lead}>{f.pageLead(items.length, unread)}</p>
        {items.length === 0 ? (
          <p className={styles.empty}>{f.empty}</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={item.seen_at ? `${styles.item} ${styles.seen}` : styles.item}>
                <p className={styles.message}>{item.message}</p>
                <p className={styles.meta}>
                  <span>{item.name ?? item.email ?? item.candidate_id}</span>
                  {item.email && <a href={`mailto:${item.email}`}>{item.email}</a>}
                  <span>{item.page ?? '—'}</span>
                  <span>{f.channels[item.channel]}</span>
                  <span>{date.format(new Date(item.created_at))}</span>
                </p>
                <button type="button" className="text-btn" onClick={() => void toggle(item)}>
                  {item.seen_at ? f.markUnread : f.markSeen}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}

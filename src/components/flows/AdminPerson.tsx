'use client'

import Link from 'next/link'
import { useState } from 'react'
import Header from '@/components/Header'
import { useI18n } from '@/components/I18nProvider'
import AdminFeedbackList from '@/components/flows/AdminFeedbackList'
import type { AdminFeedbackItem } from '@/lib/admin/feedback-triage'
import { adminDictionaries } from '@/lib/i18n/dictionaries/admin'
import styles from '@/app/admin/admin.module.css'

export interface AdminPersonFacts {
  id: string
  name: string | null
  email: string | null
  role: 'owner' | 'member'
  locale: string | null
  created_at: string
  setup_at: string | null
  invited_at: string | null
}

export default function AdminPerson({ person, feedback: initial }: { person: AdminPersonFacts; feedback: AdminFeedbackItem[] }) {
  const { locale } = useI18n()
  const a = adminDictionaries[locale]
  const p = a.person
  const [feedback, setFeedback] = useState(initial)
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <Header />
      <main className={styles.page}>
        <Link href="/admin" className={styles.back}>
          ← {a.back}
        </Link>
        <h1 className={styles.title} style={{ marginTop: 16 }}>
          {person.name ?? person.email ?? person.id}
        </h1>
        <dl className={styles.facts}>
          {person.email && (
            <>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${person.email}`}>{person.email}</a>
              </dd>
            </>
          )}
          <dt>{p.joined}</dt>
          <dd>{date.format(new Date(person.created_at))}</dd>
          <dt>{p.setup}</dt>
          <dd>{person.setup_at ? date.format(new Date(person.setup_at)) : p.notSetup}</dd>
          {person.invited_at && (
            <>
              <dt>{a.tabs.waitlist}</dt>
              <dd>{p.fromWaitlist(date.format(new Date(person.invited_at)))}</dd>
            </>
          )}
          <dt>{p.locale}</dt>
          <dd>{person.locale?.toUpperCase() ?? '—'}</dd>
          <dt>{p.roleLabel}</dt>
          <dd>{p.role[person.role]}</dd>
        </dl>

        <h2 className={styles.section}>{p.feedback}</h2>
        {feedback.length === 0 ? (
          <p className={styles.note}>{p.noFeedback}</p>
        ) : (
          <AdminFeedbackList items={feedback} onChange={setFeedback} linkPeople={false} />
        )}
      </main>
    </>
  )
}

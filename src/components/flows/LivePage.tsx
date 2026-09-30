'use client'

import Link from 'next/link'
import { useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import LiveForm from '@/components/flows/LiveForm'
import styles from '@/app/opportunities/application.module.css'

export default function LivePage({ opportunityId, company, title }: { opportunityId: string; company: string; title: string }) {
  const a = useT().opportunities.apply
  const [state, setState] = useState<'open' | 'sent' | 'closed'>('open')
  // No offer behind the address (an old or cut link): nothing to watch, said
  // plainly, with the way back.
  if (!company) {
    return (
      <>
        <Header />
        <main className={styles.livePage}>
          <div className={styles.liveEmpty}>
            <Symbol size={56} watch />
            <h1 className={styles.liveEmptyTitle}>{a.liveNoneTitle}</h1>
            <p className={styles.liveEmptyLead}>{a.liveNoneLead}</p>
            <Link className="btn" href="/opportunities?tab=wanted">
              {a.liveBack}
            </Link>
          </div>
        </main>
      </>
    )
  }
  return (
    <>
      <Header />
      <main className={styles.livePage}>
        <h1 className={styles.liveHeading}>{title ? `${title} · ${company}` : company}</h1>
        {state === 'open' && <LiveForm opportunityId={opportunityId} company={company} left={[]} onSent={() => setState('sent')} onClosed={() => setState('closed')} />}
        {state === 'sent' && <p className={styles.windowLine}>{a.liveSent(company)}</p>}
        {state === 'closed' && <p className={styles.warning}>{a.liveGone}</p>}
        <Link className="text-btn" href="/opportunities?tab=wanted">
          {a.liveBack}
        </Link>
      </main>
    </>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import { useI18n } from '@/components/I18nProvider'
import { CopyButton } from '@/components/flows/FormAnswers'
import { useVisibleInterval } from '@/components/flows/useVisibleInterval'
import type { CvReviewState, FilterCheck, ReviewItem } from '@/lib/career/cv-review'
import styles from '@/app/me/cv/cv.module.css'

type Words = ReturnType<typeof useI18n>['t']['cv']

// "Pigment, Factorial y 2 más": the offers that ask for it, by company.
export function companiesText(item: ReviewItem, c: Pick<Words, 'andMore' | 'and'>): string {
  const names = [...new Set(item.offers.map((offer) => offer.company))]
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ${c.and} ${names[names.length - 1]}`
  return `${names.slice(0, 2).join(', ')} ${c.andMore(names.length - 2)}`
}

export function checkText(check: FilterCheck, c: Words): string {
  switch (check.kind) {
    case 'long':
      return c.check.long(check.pages)
    case 'undated':
    case 'generic':
      return c.check[check.kind](check.quote)
    default:
      return c.check[check.kind]
  }
}

function Item({ item, c }: { item: ReviewItem; c: Words }) {
  return (
    <li className={styles.item}>
      <p className={styles.need}>{item.need}</p>
      <p className={styles.meta}>{c.askedBy(companiesText(item, c))}</p>
      {item.cvQuote && (
        <p className={styles.quote}>
          <span className={styles.label}>{c.yourCvSays}</span> «{item.cvQuote}»
        </p>
      )}
      {item.proof.length > 0 && (
        <div className={styles.proof}>
          <span className={styles.label}>{c.knownFrom}</span>
          <ul>
            {item.proof.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {item.line && (
        <div className={styles.line}>
          <span className={styles.label}>{c.youCouldWrite}</span>
          <p>{item.line}</p>
          <CopyButton text={item.line} label={{ copy: c.copy, copied: c.copied }} />
        </div>
      )}
    </li>
  )
}

function Section({ title, lead, items, c }: { title: string; lead: string; items: ReviewItem[]; c: Words }) {
  if (items.length === 0) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.body}>{lead}</p>
      <ul className={styles.items}>
        {items.map((item) => (
          <Item key={item.need} item={item} c={c} />
        ))}
      </ul>
    </section>
  )
}

export default function CvReviewFlow({ state, updating }: { state: CvReviewState; updating: boolean }) {
  const router = useRouter()
  const { locale, t } = useI18n()
  const c = t.cv
  // Under way: the page asks again until it is there.
  useVisibleInterval(() => router.refresh(), 6_000, updating)

  let body: React.ReactNode
  if (state.kind === 'no_cv') {
    body = (
      <>
        <p className={styles.body}>{c.noCv}</p>
        <div className={styles.actions}>
          <Link className="btn" href="/onboarding">
            {c.uploadCv}
          </Link>
        </div>
      </>
    )
  } else if (state.kind === 'few_offers') {
    body = <p className={styles.body}>{c.fewOffers(state.have, state.need)}</p>
  } else if (state.kind === 'building') {
    body = <p className={styles.body}>{c.building}</p>
  } else if (state.kind === 'failed') {
    body = <p className={styles.body}>{c.failed}</p>
  } else {
    const { review } = state
    const date = new Date(review.createdAt).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long' })
    const empty = review.hidden.length + review.weak.length + review.missing.length + review.filter.length === 0
    body = (
      <>
        <p className={styles.meta}>{c.basedOn(review.offersRead, date)}</p>
        {updating && <p className={styles.body}>{c.refreshing}</p>}
        {empty && <p className={styles.body}>{c.nothing}</p>}
        <Section title={c.hiddenTitle} lead={c.hiddenLead} items={review.hidden} c={c} />
        <Section title={c.weakTitle} lead={c.weakLead} items={review.weak} c={c} />
        <Section title={c.missingTitle} lead={c.missingLead} items={review.missing} c={c} />
        {review.filter.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{c.filterTitle}</h2>
            <p className={styles.body}>{c.filterLead}</p>
            <ul className={styles.items}>
              {review.filter.map((check, index) => (
                <li key={`${check.kind}-${index}`} className={styles.item}>
                  <p>{checkText(check, c)}</p>
                  {'line' in check && check.line && (
                    <div className={styles.line}>
                      <span className={styles.label}>{c.youCouldWrite}</span>
                      <p>{check.line}</p>
                      <CopyButton text={check.line} label={{ copy: c.copy, copied: c.copied }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {review.missing.length > 0 && (
          <div className={styles.actions}>
            <Link className="btn" href="/me">
              {c.toMap}
            </Link>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{c.title}</h1>
        <p className={styles.lead}>{c.lead}</p>
        {body}
      </main>
    </>
  )
}

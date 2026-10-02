'use client'

import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import { requestJson } from '@/components/api'
import type { AdminHealth as Health, WhatsAppAccountState } from '@/lib/admin/health'
import { adminDictionaries } from '@/lib/i18n/dictionaries/admin'
import styles from '@/app/admin/admin.module.css'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; health: Health; whatsapp: WhatsAppAccountState }

async function fetchHealth(): Promise<State> {
  const { ok, data } = await requestJson<{ health: Health; whatsapp: WhatsAppAccountState }>('/api/admin/health')
  return ok ? { status: 'ok', health: data.health, whatsapp: data.whatsapp } : { status: 'error' }
}

// How amble is doing, read when the tab opens (and again on asking): the
// passes, the model, each person, WhatsApp, the forms and the alerts.
export default function AdminHealth() {
  const { locale } = useI18n()
  const h = adminDictionaries[locale].health
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    setState(await fetchHealth())
    setBusy(false)
  }

  useEffect(() => {
    let current = true
    void fetchHealth().then((next) => current && setState(next))
    return () => {
      current = false
    }
  }, [])

  if (state.status === 'loading') return <p className={styles.note}>{h.loading}</p>
  if (state.status === 'error') {
    return (
      <>
        <p className={styles.note}>{h.error}</p>
        <button type="button" className="text-btn" onClick={() => void load()} disabled={busy}>
          {h.retry}
        </button>
      </>
    )
  }

  const { health, whatsapp } = state
  const number = new Intl.NumberFormat(locale)
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const dayOf = (value: string) => day.format(new Date(`${value}T12:00:00Z`))
  const minutes = (from: string, to: string) => h.minutes(Math.round((Date.parse(to) - Date.parse(from)) / 60_000))
  // A count that needs looking at stands out, in words as well as colour.
  const flagged = (n: number) => (n > 0 ? styles.warn : undefined)

  return (
    <>
      <div className={styles.tools}>
        <span className={styles.hint}>{h.readAt(time.format(new Date(health.at)))}</span>
        <button type="button" className="text-btn" onClick={() => void load()} disabled={busy}>
          {h.refresh}
        </button>
      </div>

      <h2 className={styles.section}>{h.passes.title}</h2>
      {health.passes.length === 0 ? (
        <p className={styles.note}>{h.passes.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{h.passes.columns.when}</th>
                <th>{h.passes.columns.duration}</th>
                <th className={styles.num}>{h.passes.columns.read}</th>
                <th className={styles.num}>{h.passes.columns.outOfTime}</th>
                <th className={styles.num}>{h.passes.columns.errors}</th>
                <th>{h.passes.columns.outcome}</th>
              </tr>
            </thead>
            <tbody>
              {health.passes.map((pass) => (
                <tr key={`${pass.slot}-${pass.started_at}`}>
                  <td>{when.format(new Date(pass.started_at))}</td>
                  <td className={styles.muted}>{minutes(pass.started_at, pass.finished_at)}</td>
                  <td className={styles.num}>{number.format(pass.read)}</td>
                  <td className={`${styles.num} ${flagged(pass.out_of_time) ?? ''}`}>{number.format(pass.out_of_time)}</td>
                  <td className={`${styles.num} ${flagged(pass.errors) ?? ''}`}>{number.format(pass.errors)}</td>
                  <td>
                    <span className={pass.outcome === 'failed' ? styles.warn : undefined}>{h.passes.outcome[pass.outcome]}</span>
                    {pass.first_error && <span className={styles.cellNote}>{pass.first_error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={styles.section}>{h.model.title}</h2>
      <p className={styles.hint}>{h.model.limitedHint}</p>
      <h3 className={styles.subsection}>{h.model.days}</h3>
      {health.modelDays.length === 0 ? (
        <p className={styles.note}>{h.model.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{h.model.columns.day}</th>
                <th className={styles.num}>{h.model.columns.calls}</th>
                <th className={styles.num}>{h.model.columns.failed}</th>
                <th className={styles.num}>{h.model.columns.limited}</th>
                <th className={styles.num}>{h.model.columns.input}</th>
                <th className={styles.num}>{h.model.columns.cached}</th>
                <th className={styles.num}>{h.model.columns.output}</th>
              </tr>
            </thead>
            <tbody>
              {health.modelDays.map((row) => (
                <tr key={row.day}>
                  <td>{dayOf(row.day)}</td>
                  <td className={styles.num}>{number.format(row.calls)}</td>
                  <td className={`${styles.num} ${flagged(row.failed) ?? ''}`}>{number.format(row.failed)}</td>
                  <td className={`${styles.num} ${flagged(row.limited) ?? ''}`}>{number.format(row.limited)}</td>
                  <td className={styles.num}>{compact.format(row.prompt_tokens)}</td>
                  <td className={styles.num}>{compact.format(row.cached_tokens)}</td>
                  <td className={styles.num}>{compact.format(row.completion_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className={styles.subsection}>{h.model.people}</h3>
      {health.modelPeople.length === 0 ? (
        <p className={styles.note}>{h.model.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{h.model.columns.who}</th>
                <th className={styles.num}>{h.model.columns.calls}</th>
                <th className={styles.num}>{h.model.columns.failed}</th>
                <th className={styles.num}>{h.model.columns.limited}</th>
                <th className={styles.num}>{h.model.columns.input}</th>
                <th className={styles.num}>{h.model.columns.cached}</th>
                <th className={styles.num}>{h.model.columns.output}</th>
              </tr>
            </thead>
            <tbody>
              {health.modelPeople.map((row) => (
                <tr key={row.candidate_id ?? 'shared'}>
                  <td className={styles.who}>{row.candidate_id ? row.who ?? row.candidate_id : <span className={styles.muted}>{h.model.shared}</span>}</td>
                  <td className={styles.num}>{number.format(row.calls)}</td>
                  <td className={`${styles.num} ${flagged(row.failed) ?? ''}`}>{number.format(row.failed)}</td>
                  <td className={`${styles.num} ${flagged(row.limited) ?? ''}`}>{number.format(row.limited)}</td>
                  <td className={styles.num}>{compact.format(row.prompt_tokens)}</td>
                  <td className={styles.num}>{compact.format(row.cached_tokens)}</td>
                  <td className={styles.num}>{compact.format(row.completion_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.hint}>{h.utcDays}</p>

      <h2 className={styles.section}>{h.people.title}</h2>
      <p className={styles.hint}>{h.people.hint}</p>
      {health.people.length === 0 ? (
        <p className={styles.note}>{h.people.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{h.people.columns.who}</th>
                <th className={styles.num}>{h.people.columns.waiting}</th>
                <th>{h.people.columns.lastRead}</th>
                <th className={styles.num}>{h.people.columns.shown}</th>
                <th className={styles.num}>{h.people.columns.hold}</th>
                <th className={styles.num}>{h.people.columns.discarded}</th>
                <th className={styles.num}>{h.people.columns.released}</th>
                <th className={styles.num}>{h.people.columns.outOfTime}</th>
              </tr>
            </thead>
            <tbody>
              {health.people.map((person) => (
                <tr key={person.candidate_id}>
                  <td className={styles.who}>
                    <Link href={`/admin/people/${encodeURIComponent(person.candidate_id)}`}>{person.who}</Link>
                    {person.paused && <span className={styles.tag}>{h.people.paused}</span>}
                  </td>
                  <td className={styles.num}>{person.waiting === null ? h.none : number.format(person.waiting)}</td>
                  <td className={styles.muted}>{person.last_read_at ? when.format(new Date(person.last_read_at)) : h.people.never}</td>
                  <td className={styles.num}>{number.format(person.shown)}</td>
                  <td className={styles.num}>{number.format(person.hold)}</td>
                  <td className={styles.num}>{number.format(person.discarded)}</td>
                  <td className={styles.num}>{number.format(person.released)}</td>
                  <td className={`${styles.num} ${flagged(person.out_of_time ?? 0) ?? ''}`}>{person.out_of_time === null ? h.none : number.format(person.out_of_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={styles.section}>{h.whatsapp.title}</h2>
      <h3 className={styles.subsection}>{h.whatsapp.account}</h3>
      <WhatsAppAccount account={whatsapp} />
      <h3 className={styles.subsection}>{h.whatsapp.days}</h3>
      {health.whatsappDays.length === 0 ? (
        <p className={styles.note}>{h.whatsapp.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{h.whatsapp.columns.day}</th>
                <th className={styles.num}>{h.whatsapp.columns.inbound}</th>
                <th className={styles.num}>{h.whatsapp.columns.outbound}</th>
                <th className={styles.num}>{h.whatsapp.columns.reviewed}</th>
                <th className={styles.num}>{h.whatsapp.columns.sent}</th>
                <th className={styles.num}>{h.whatsapp.columns.failed}</th>
              </tr>
            </thead>
            <tbody>
              {health.whatsappDays.map((row) => (
                <tr key={row.day}>
                  <td>{dayOf(row.day)}</td>
                  <td className={styles.num}>{number.format(row.inbound)}</td>
                  <td className={styles.num}>{number.format(row.outbound)}</td>
                  <td className={styles.num}>{number.format(row.reviewed)}</td>
                  <td className={styles.num}>{number.format(row.offers_sent)}</td>
                  <td className={`${styles.num} ${flagged(row.offers_failed) ?? ''}`}>{number.format(row.offers_failed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.hint}>
        {h.whatsapp.failedHint} {h.utcDays}
      </p>

      <h2 className={styles.section}>{h.applications.title}</h2>
      {health.applications.length === 0 ? (
        <p className={styles.note}>{h.applications.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{h.applications.columns.when}</th>
                <th>{h.applications.columns.who}</th>
                <th>{h.applications.columns.offer}</th>
                <th>{h.applications.columns.kind}</th>
                <th>{h.applications.columns.outcome}</th>
              </tr>
            </thead>
            <tbody>
              {health.applications.map((run, index) => (
                <tr key={`${run.started_at}-${index}`}>
                  <td className={styles.muted}>
                    {when.format(new Date(run.started_at))}
                    <span className={styles.cellNote}>{minutes(run.started_at, run.ended_at)}</span>
                  </td>
                  <td className={styles.who}>{run.who}</td>
                  <td>
                    {run.title ?? h.none}
                    {run.company && <span className={styles.cellNote}>{run.company}</span>}
                  </td>
                  <td>
                    {h.applications.kinds[run.kind]}
                    <span className={styles.cellNote}>{h.applications.via[run.via]}</span>
                  </td>
                  <td>
                    <span className={run.outcome === 'error' || run.outcome === 'blocked' ? styles.warn : undefined}>
                      {h.applications.outcomes[run.outcome] ?? run.outcome}
                    </span>
                    {run.detail && <span className={styles.cellNote}>{run.detail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={styles.section}>{h.alerts.title}</h2>
      <p className={styles.hint}>{h.alerts.hint}</p>
      {health.alerts.length === 0 ? (
        <p className={styles.note}>{h.alerts.none}</p>
      ) : (
        <dl className={styles.facts}>
          {health.alerts.map((alert) => (
            <Fragment key={alert.kind}>
              <dt>{h.alerts.kinds[alert.kind] ?? alert.kind}</dt>
              <dd>{alert.sent_at ? when.format(new Date(alert.sent_at)) : h.none}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </>
  )
}

function WhatsAppAccount({ account }: { account: WhatsAppAccountState }) {
  const { locale } = useI18n()
  const w = adminDictionaries[locale].health.whatsapp
  const none = adminDictionaries[locale].health.none
  if (account.connection === 'off') return <p className={styles.note}>{w.off}</p>
  if (account.connection === 'error') return <p className={styles.note}>{w.error(account.status)}</p>
  const facts: [string, string | null][] = [
    [w.fields.displayName, account.displayName],
    [w.fields.nameStatus, account.nameStatus],
    [w.fields.lastReviewedName, account.lastReviewedName],
    [w.fields.lastEvent, account.lastEvent],
    [w.fields.tier, account.messagingLimitTier],
    [w.fields.quality, account.qualityRating],
  ]
  return (
    <>
      {account.sandbox && <p className={styles.hint}>{w.sandbox}</p>}
      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value ?? none}</dd>
          </Fragment>
        ))}
      </dl>
      <h3 className={styles.subsection}>{w.templates}</h3>
      {account.templates.length === 0 ? (
        <p className={styles.note}>{w.noTemplates}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{w.templateColumns.name}</th>
                <th>{w.templateColumns.language}</th>
                <th>{w.templateColumns.category}</th>
                <th>{w.templateColumns.status}</th>
              </tr>
            </thead>
            <tbody>
              {account.templates.map((template, index) => (
                <tr key={`${template.name}-${template.language}-${index}`}>
                  <td>{template.name}</td>
                  <td className={styles.muted}>{template.language ?? none}</td>
                  <td className={styles.muted}>{template.category ?? none}</td>
                  <td className={template.status && template.status !== 'APPROVED' ? styles.warn : undefined}>{template.status ?? none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

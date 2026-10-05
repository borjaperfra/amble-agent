'use client'

import Link from 'next/link'
import { useState } from 'react'
import Header from '@/components/Header'
import InlineEdit from '@/components/InlineEdit'
import { useI18n, useT } from '@/components/I18nProvider'
import { postJson } from '@/components/api'
import type { LanguageLevel } from '@/lib/db/repo'
import type { RuleGroup, RuleView, RulesView } from '@/lib/pipeline/rules'
import styles from '@/app/me/preferences/preferences.module.css'

// What decides first, first: what rules an offer out, then the floor, then
// what weighs, then what never rules one out.
const GROUPS: RuleGroup[] = ['never', 'pay', 'weighs', 'notFor']

// Where people using amble live, and the languages they work in: named in
// their language by the browser (Intl.DisplayNames).
const COUNTRIES = ['ES', 'PT', 'FR', 'IT', 'DE', 'NL', 'BE', 'IE', 'GB', 'CH', 'AT', 'PL', 'SE', 'DK', 'NO', 'FI', 'GR', 'RO', 'CZ', 'US', 'CA', 'MX', 'AR', 'CO', 'CL', 'BR']
const LANGUAGES = ['es', 'en', 'ca', 'eu', 'gl', 'pt', 'fr', 'it', 'de', 'nl', 'pl', 'sv', 'da', 'no', 'fi', 'ro', 'el', 'ar', 'zh', 'ja']
const LEVELS: LanguageLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']

function About({ about, hasPay, busy, onSave }: { about: RulesView['about']; hasPay: boolean; busy: boolean; onSave: (homeCountry: string, languages: { code: string; level: LanguageLevel }[]) => void }) {
  const t = useT()
  const a = t.preferences.about
  const { locale } = useI18n()
  const name = (type: 'region' | 'language', code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type }).of(code) ?? code
    } catch {
      return code
    }
  }
  const [home, setHome] = useState(about.homeCountry ?? '')
  // Inferred languages come without a level: shown as B2, theirs to change.
  const [languages, setLanguages] = useState(about.languages.map((item) => ({ code: item.code, level: item.level ?? ('B2' as LanguageLevel) })))
  const [adding, setAdding] = useState('')
  const changed =
    home !== (about.homeCountry ?? '') ||
    !about.languagesStated ||
    JSON.stringify(languages) !== JSON.stringify(about.languages.map((item) => ({ code: item.code, level: item.level ?? 'B2' })))
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)

  return (
    <section className={styles.about} aria-labelledby="about-title">
      <h2 className={styles.groupTitle} id="about-title">
        {a.title}
      </h2>
      <p className={styles.hint}>{a.lead}</p>

      <div className={styles.aboutRow}>
        <label className={styles.aboutLabel} htmlFor="about-home">
          {a.home}
        </label>
        <select id="about-home" className={styles.select} value={home} onChange={(event) => setHome(event.target.value)}>
          <option value="">{a.homeUnknown}</option>
          {[...new Set([...(about.homeCountry ? [about.homeCountry] : []), ...COUNTRIES])].map((code) => (
            <option key={code} value={code}>
              {name('region', code)}
            </option>
          ))}
        </select>
        {!about.homeStated && about.homeCountry && <p className={styles.hint}>{a.inferred}</p>}
      </div>

      <div className={styles.aboutRow}>
        <p className={styles.aboutLabel}>{a.languages}</p>
        <ul className={styles.languages} role="list">
          {languages.map((item, index) => (
            <li key={item.code} className={styles.language}>
              <span className={styles.languageName}>{name('language', item.code)}</span>
              <select
                id={`about-level-${item.code}`}
                className={styles.select}
                aria-label={a.level(name('language', item.code))}
                value={item.level}
                onChange={(event) => setLanguages((prev) => prev.map((other, i) => (i === index ? { ...other, level: event.target.value as LanguageLevel } : other)))}
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level === 'native' ? a.native : level}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`text-btn ${styles.remove}`}
                aria-label={a.removeLanguage(name('language', item.code))}
                onClick={() => setLanguages((prev) => prev.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <select
          id="about-add-language"
          className={styles.select}
          aria-label={a.addLanguage}
          value={adding}
          onChange={(event) => {
            const code = event.target.value
            if (code) setLanguages((prev) => [...prev, { code, level: 'B2' }])
            setAdding('')
          }}
        >
          <option value="">{a.addLanguage}</option>
          {LANGUAGES.filter((code) => !languages.some((item) => item.code === code)).map((code) => (
            <option key={code} value={code}>
              {name('language', code)}
            </option>
          ))}
        </select>
        <p className={styles.hint}>{!about.languagesStated && about.languages.length > 0 ? a.languagesInferred : a.languagesNote}</p>
      </div>

      <div className={styles.aboutRow}>
        <p className={styles.aboutLabel}>{a.floor}</p>
        <p className={styles.floor}>{about.floor ? money(about.floor.amount, about.floor.currency) : hasPay ? a.floorPending : a.floorNone}</p>
        {about.floor && <p className={styles.hint}>{a.floorFrom}</p>}
      </div>

      <button type="button" className="btn btn-quiet" disabled={busy || !changed} onClick={() => onSave(home, languages)}>
        {a.save}
      </button>
    </section>
  )
}

export default function PreferencesFlow({ initial }: { initial: RulesView }) {
  const t = useT()
  const p = t.preferences
  const [rules, setRules] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<'saved' | 'failed' | null>(null)
  const [drafts, setDrafts] = useState<Record<RuleGroup, string>>({ never: '', pay: '', weighs: '', notFor: '' })

  async function act(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setNote(null)
    const { ok, data } = await postJson<RulesView>('/api/rules', body)
    setBusy(false)
    if (!ok) {
      setNote('failed')
      return false
    }
    setRules({ rules: data.rules, proposed: data.proposed, about: data.about })
    setNote('saved')
    return true
  }

  async function add(group: RuleGroup) {
    const text = drafts[group].trim()
    if (!text) return
    if (await act({ action: 'add', group, text })) setDrafts((prev) => ({ ...prev, [group]: '' }))
  }

  const source = (rule: RuleView) => (rule.source ? (p.sources as Record<string, string>)[rule.source] : null)

  return (
    <>
      <Header />
      <main className={styles.page}>
        <header className={styles.top}>
          <h1 className={styles.title}>{p.title}</h1>
          <p className={styles.lead}>{p.lead}</p>
        </header>

        {rules.proposed.length > 0 && (
          <section className={styles.proposed} aria-labelledby="proposed-title">
            <h2 className={styles.proposedTitle} id="proposed-title">
              {p.proposedTitle}
            </h2>
            <p className={styles.hint}>{p.proposedLead}</p>
            <ul className={styles.list} role="list">
              {rules.proposed.map((rule) => (
                <li key={rule.id} className={styles.rule}>
                  <span className={styles.ruleGroup}>{p.groups[rule.group]}</span>
                  <p className={styles.ruleText}>{rule.text}</p>
                  <span className={styles.actions}>
                    <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act({ action: 'keep', id: rule.id })}>
                      {p.accept}
                    </button>
                    <button type="button" className="text-btn" disabled={busy} onClick={() => void act({ action: 'remove', id: rule.id })}>
                      {p.reject}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <About
          // A fresh form with what was saved, once it comes back.
          key={JSON.stringify(rules.about)}
          about={rules.about}
          hasPay={rules.rules.some((rule) => rule.group === 'pay' && !rule.stale)}
          busy={busy}
          onSave={(homeCountry, languages) => void act({ action: 'about', homeCountry, languages })}
        />

        <div className={styles.groups}>
          {GROUPS.map((group) => {
            const inGroup = rules.rules.filter((rule) => rule.group === group)
            return (
              <section key={group} className={styles.group} aria-labelledby={`group-${group}`}>
                <h2 className={styles.groupTitle} id={`group-${group}`}>
                  {p.groups[group]}
                </h2>
                <p className={styles.hint}>{p.hints[group]}</p>
                {inGroup.length > 0 ? (
                  <ul className={styles.list} role="list">
                    {inGroup.map((rule) => (
                      <li key={rule.id} className={`${styles.rule} ${rule.stale ? styles.stale : ''}`}>
                        <div className={styles.ruleText}>
                          <InlineEdit value={rule.text} label={p.editLabel(p.groups[group])} onChange={(text) => void act({ action: 'change', id: rule.id, text })} />
                        </div>
                        <span className={styles.meta}>
                          {source(rule) && <span className={styles.source}>{source(rule)}</span>}
                          <button
                            type="button"
                            className={`text-btn ${styles.remove}`}
                            disabled={busy}
                            aria-label={p.removeLabel(rule.text)}
                            onClick={() => void act({ action: 'remove', id: rule.id })}
                          >
                            {p.remove}
                          </button>
                        </span>
                        {rule.stale && (
                          <p className={styles.staleNote}>
                            {p.stale}{' '}
                            <button type="button" className="text-btn" disabled={busy} onClick={() => void act({ action: 'keep', id: rule.id })}>
                              {p.keep}
                            </button>
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.empty}>{p.empty}</p>
                )}
                <form
                  className={styles.add}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void add(group)
                  }}
                >
                  <input
                    id={`add-${group}`}
                    className={styles.addInput}
                    aria-label={p.addLabel(p.groups[group])}
                    placeholder={p.placeholders[group]}
                    value={drafts[group]}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [group]: event.target.value }))}
                  />
                  <button type="submit" className="btn btn-quiet" disabled={busy || !drafts[group].trim()}>
                    {p.add}
                  </button>
                </form>
              </section>
            )
          })}
        </div>

        <p className={styles.note} role="status">
          {note === 'saved' ? p.saved : note === 'failed' ? p.saveFailed : ''}
        </p>

        <section className={styles.other} aria-labelledby="other-title">
          <h2 className={styles.otherTitle} id="other-title">
            {p.otherWays}
          </h2>
          <Link href="/me/intent" className={styles.otherLink}>
            {p.sayIt}
          </Link>
          <Link href="/me/triage" className={styles.otherLink}>
            {p.sample}
          </Link>
          <Link href="/listening" className={`text-btn ${styles.back}`}>
            {p.back}
          </Link>
        </section>
      </main>
    </>
  )
}

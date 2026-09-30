import { candidateById, decideRevealedPreference, getLatestOfferTriage, getRevealedPreference, insertCandidatePreference, newId } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { awaitingOf, setAwaiting, type ProposedPreference } from './offers'

// A change to what the Rep listens for, asked for on WhatsApp: the agent
// proposes it, and only a yes makes it one of their rules, written by them.
// A rule it replaces (a new floor for the old one) stops holding then.
// Their rules hang on the triage that revealed them; without one yet, the
// change is made in the app. Each proposal has its own buttons: a yes on an
// older one never confirms the newer.

const HOURS_TO_ANSWER = 24

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

export function proposePreference(candidateId: string, preference: ProposedPreference): { title: string; payload: string }[] {
  // Only one of their confirmed rules can be replaced.
  const replaced = preference.replaces ? getRevealedPreference(preference.replaces) : undefined
  const replaces = replaced?.candidate_id === candidateId && replaced.status === 'confirmed' ? replaced.id : null
  const id = newId('prp').slice(4, 12)
  setAwaiting(candidateId, { kind: 'preference', id, preference: { ...preference, replaces }, until: new Date(Date.now() + HOURS_TO_ANSWER * 60 * 60 * 1000).toISOString() })
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  return [
    { title: w.preferenceButtons.yes, payload: `pr:${id}:yes` },
    { title: w.preferenceButtons.no, payload: `pr:${id}:no` },
  ]
}

export interface PreferenceTap {
  id: string | null
  answer: 'yes' | 'no'
}

// pr:<id>:yes|no; plain pr:yes|no from before proposals had an id.
export function parsePreferencePayload(value: string | null): PreferenceTap | null {
  const match = value?.match(/^pr:(?:(\w+):)?(yes|no)$/)
  return match ? { id: match[1] ?? null, answer: match[2] as 'yes' | 'no' } : null
}

export async function answerPreference(candidateId: string, tap: PreferenceTap, reply: Reply, appUrl: (candidateId: string, route: string) => string): Promise<void> {
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const awaiting = awaitingOf(candidateId)
  if (awaiting?.kind !== 'preference' || (awaiting.id ?? null) !== tap.id) {
    await reply(w.preferenceExpired)
    return
  }
  setAwaiting(candidateId, null)
  if (tap.answer === 'no') {
    await reply(w.preferenceKept)
    return
  }
  const triage = getLatestOfferTriage(candidateId)
  if (!triage) {
    await reply(w.preferenceInApp(appUrl(candidateId, '/me/intent')))
    return
  }
  insertCandidatePreference({
    candidateId,
    triageId: triage.id,
    kind: awaiting.preference.kind,
    statement: awaiting.preference.statement,
    label: awaiting.preference.label || null,
    evidenceProbeIds: [],
    quote: null,
  })
  if (awaiting.preference.replaces) decideRevealedPreference(awaiting.preference.replaces, 'rejected')
  await reply(w.preferenceSaved(awaiting.preference.label || awaiting.preference.statement))
}

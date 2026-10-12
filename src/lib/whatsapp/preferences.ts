import { candidateById, decideRevealedPreference, getRevealedPreference, insertCandidatePreference, newId } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { requestReread } from '../matching/run'
import { awaitingOf, setAwaiting, type ProposedPreference } from './offers'

// A change to what the Rep listens for, asked for on WhatsApp: the agent
// proposes it, and only a yes makes it one of their rules, written by them.
// A rule it replaces (a new floor for the old one) stops holding then.
// It hangs on their latest triage when they have one, on nothing otherwise
// (a new account's rules come from what they said they look for). When
// whether it rules offers out is unclear, they choose: only that, or prefer
// it. Each proposal has its own buttons: a yes on an older one never
// confirms the newer.

const HOURS_TO_ANSWER = 24

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

// labels: the yes and no in other words (after a «no encaja», #42).
export function proposePreference(
  candidateId: string,
  preference: ProposedPreference,
  labels?: { yes: string; no: string },
): { title: string; payload: string }[] {
  // Only one of their confirmed rules can be replaced.
  const replaced = preference.replaces ? getRevealedPreference(preference.replaces) : undefined
  const replaces = replaced?.candidate_id === candidateId && replaced.status === 'confirmed' ? replaced.id : null
  const id = newId('prp').slice(4, 12)
  setAwaiting(candidateId, { kind: 'preference', id, preference: { ...preference, replaces }, until: new Date(Date.now() + HOURS_TO_ANSWER * 60 * 60 * 1000).toISOString() })
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  if (preference.either) {
    return [
      { title: w.preferenceButtons.only, payload: `pr:${id}:only` },
      { title: w.preferenceButtons.prefer, payload: `pr:${id}:prefer` },
      { title: w.preferenceButtons.no, payload: `pr:${id}:no` },
    ]
  }
  return [
    { title: labels?.yes ?? w.preferenceButtons.yes, payload: `pr:${id}:yes` },
    { title: labels?.no ?? w.preferenceButtons.no, payload: `pr:${id}:no` },
  ]
}

export interface PreferenceTap {
  id: string | null
  // only: it rules the rest out; prefer: it weighs, the rest still comes.
  answer: 'yes' | 'no' | 'only' | 'prefer'
}

// pr:<id>:yes|no|only|prefer; plain pr:yes|no from before proposals had an id.
export function parsePreferencePayload(value: string | null): PreferenceTap | null {
  const match = value?.match(/^pr:(?:(\w+):)?(yes|no|only|prefer)$/)
  return match ? { id: match[1] ?? null, answer: match[2] as PreferenceTap['answer'] } : null
}

export async function answerPreference(candidateId: string, tap: PreferenceTap, reply: Reply): Promise<void> {
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
  const kind = tap.answer === 'only' ? 'hard_filter' : tap.answer === 'prefer' ? 'strong' : awaiting.preference.kind
  insertCandidatePreference({
    candidateId,
    // Told in the chat: no triage behind it.
    triageId: null,
    kind,
    statement: awaiting.preference.statement,
    label: awaiting.preference.label || null,
    evidenceProbeIds: [],
    quote: null,
    source: 'chat',
  })
  if (awaiting.preference.replaces) decideRevealedPreference(awaiting.preference.replaces, 'rejected')
  // What was read lately is read again with the new rule, in the background.
  requestReread(candidateId)
  await reply(w.preferenceSaved(awaiting.preference.label || awaiting.preference.statement))
}

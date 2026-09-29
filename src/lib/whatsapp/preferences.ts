import { candidateById, getLatestOfferTriage, insertCandidatePreference } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { awaitingOf, setAwaiting } from './offers'

// A change to what the Rep listens for, asked for on WhatsApp: the agent
// proposes it, and only a yes makes it one of their rules, written by them.
// Their rules hang on the triage that revealed them; without one yet, the
// change is made in the app.

const HOURS_TO_ANSWER = 24

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

export function proposePreference(
  candidateId: string,
  preference: { kind: 'hard_filter' | 'compensation' | 'strong'; label: string; statement: string },
): { title: string; payload: string }[] {
  setAwaiting(candidateId, { kind: 'preference', preference, until: new Date(Date.now() + HOURS_TO_ANSWER * 60 * 60 * 1000).toISOString() })
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  return [
    { title: w.preferenceButtons.yes, payload: 'pr:yes' },
    { title: w.preferenceButtons.no, payload: 'pr:no' },
  ]
}

export function isPreferencePayload(value: string | null): value is 'pr:yes' | 'pr:no' {
  return value === 'pr:yes' || value === 'pr:no'
}

export async function answerPreference(candidateId: string, answer: 'pr:yes' | 'pr:no', reply: Reply, appUrl: (route: string) => string): Promise<void> {
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const awaiting = awaitingOf(candidateId)
  if (awaiting?.kind !== 'preference') {
    await reply(w.preferenceExpired)
    return
  }
  setAwaiting(candidateId, null)
  if (answer === 'pr:no') {
    await reply(w.preferenceKept)
    return
  }
  const triage = getLatestOfferTriage(candidateId)
  if (!triage) {
    await reply(w.preferenceInApp(appUrl('/me/intent')))
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
  await reply(w.preferenceSaved(awaiting.preference.label || awaiting.preference.statement))
}

import { z } from 'zod'
import { issueAppLink } from '../auth/applinks'
import { candidateById, listClaims, listEvidence, newId, setCandidateName } from '../db/repo'
import { candidateLocale, chooseLocale, refreshDetectedLocale, withLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import type { Locale } from '../i18n/locale'
import { runStructuredTask } from '../model/provider'
import { refreshDerivedProfile } from '../pipeline/graph'
import { takeCorrection, takeGapAnswer, takeToldNote, type IncorporatedAnswer } from '../pipeline/interview'
import { untrusted, UNTRUSTED_RULE } from '../untrusted'
import { logMessage } from './conversation'
import { reachOf } from '../channel/reach'
import { awaitingOf, setAwaiting, type ProfileChange } from './offers'

// Their map and their account, changed on WhatsApp. What they tell about
// their work is taken in as an interview answer is (the same extraction:
// nothing they did not say), and they hear what it added. What would take
// something off their map (a correction), a new name or a new language is
// proposed, and only a yes on its buttons does it. Each proposal has its own
// buttons, as a change to their rules does.

const HOURS_TO_ANSWER = 24
// What is shown of one item of their map: a line, not a paragraph.
const ITEM_CHARS = 160
const MAX_SHOWN = 4

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

const clip = (text: string) => (text.length > ITEM_CHARS ? `${text.slice(0, ITEM_CHARS - 1)}…` : text)

// Their map in the app, opening their own account.
export function mapLink(candidateId: string): string {
  return issueAppLink(candidateId, '/me')
}

// A message of amble's own, after the reply: what was added, once it is in.
async function tell(candidateId: string, text: string, key: string): Promise<void> {
  const reach = reachOf(candidateId)
  if (!reach) return
  await reach.send({ text, idempotencyKey: key })
  logMessage(candidateId, 'out', text)
}

// Once their words are taken in: what they added, as the map now says it.
// After a correction nothing added is nothing to say: what went was said.
function afterTaken(candidateId: string, turnId: () => string, quietIfNothing: boolean) {
  return async (result: IncorporatedAnswer) => {
    refreshDetectedLocale(candidateId)
    const id = turnId()
    const added = listClaims(candidateId)
      .filter((claim) => claim.interview_turn_id === id)
      .map((claim) => clip(claim.statement))
    const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
    if (added.length > 0) await tell(candidateId, w.noteAdded(added.slice(0, MAX_SHOWN), mapLink(candidateId)), `note:${id}`).catch(() => undefined)
    else if (!quietIfNothing) await tell(candidateId, w.noteNothing, `note:${id}`).catch(() => undefined)
    if (result.profileNeedsRefresh) await refreshDerivedProfile(candidateId)
  }
}

// Something about their work they told the Rep, in their own words.
export function takeNote(candidateId: string, words: string): void {
  let turnId = ''
  withLocale(candidateLocale(candidateById(candidateId)), () => {
    turnId = takeToldNote(
      candidateId,
      words,
      afterTaken(candidateId, () => turnId, false),
    )
  })
}

// Their answer to one of the questions their map shows as still unknown.
export function takeGap(candidateId: string, uncertainty: { id: string; capability_id: string | null; description: string }, words: string): void {
  let turnId = ''
  withLocale(candidateLocale(candidateById(candidateId)), () => {
    turnId = takeGapAnswer(candidateId, uncertainty, words, afterTaken(candidateId, () => turnId, false))
  })
}

// ── A correction: what it would take off their map ────────────────────────

const MATCH_SYSTEM = `You match a correction someone made to their own professional profile against what the profile says about them.
${UNTRUSTED_RULE}

Each item is one thing the profile states about them, with its id. Their message says something there is wrong: not true, not theirs (someone else's or the team's work), a wrong number, title, date or place. Return the ids of the items their message makes untrue, and only those.
- An item stays when the message only adds to it, or is about something else.
- When their message gives the right version ("6 years, not 4", "the team built it, I wrote the tests"), the item with the wrong version goes; the right version is taken in separately, so never keep a wrong item for the part of it that is right.
- When you are not sure an item is the one they mean, leave it. Never more than 8.
- "why": one short sentence, in the second person, saying what they said that makes it untrue.
Respond ONLY with JSON: {"retract": [{"id": string, "why": string}]}.`

const MAX_ITEMS = 250
const MAX_RETRACT = 8

const matchSchema = z.preprocess(
  (raw) => {
    const list = Array.isArray((raw as { retract?: unknown } | null)?.retract) ? ((raw as { retract: unknown[] }).retract) : []
    return {
      retract: list
        .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}))
        .filter((item) => typeof item.id === 'string' && item.id)
        .map((item) => ({ id: String(item.id).trim(), why: typeof item.why === 'string' ? item.why.trim().slice(0, 300) : '' })),
    }
  },
  z.object({ retract: z.array(z.object({ id: z.string(), why: z.string() })) }),
)

// The proposal, with its buttons; null when nothing on their map is what
// they say is wrong (what they said is then taken in as told).
export async function proposeCorrection(
  candidateId: string,
  words: string,
  what: string,
): Promise<{ text: string; buttons: { title: string; payload: string }[] } | null> {
  const evidence = listEvidence(candidateId).slice(-MAX_ITEMS)
  if (evidence.length === 0) return null
  const { data } = await runStructuredTask({
    candidateId,
    task: 'whatsapp_profile_correction',
    version: 'c1',
    system: MATCH_SYSTEM,
    user: `WHAT THEIR PROFILE SAYS ABOUT THEM:\n${untrusted('profile', JSON.stringify(evidence.map((item) => ({ id: item.id, statement: item.statement, quote: item.source_excerpt?.slice(0, 160) ?? null }))))}\n\nWHAT THEY SAY IS WRONG, AS THEIR REP READ IT:\n${untrusted('reading', what)}\n\nTHEIR MESSAGE:\n${untrusted('message', words)}`,
    schema: matchSchema,
    temperature: 0.1,
  })
  const byId = new Map(evidence.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const items = data.retract.filter((item) => byId.has(item.id) && !seen.has(item.id) && seen.add(item.id)).slice(0, MAX_RETRACT)
  if (items.length === 0) return null
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const buttons = propose(candidateId, { type: 'retract', items: items.map((item) => ({ evidenceId: item.id, reason: item.why || what })), words })
  return { text: w.correctionPropose(items.map((item) => clip(byId.get(item.id)!.statement))), buttons }
}

// ── The name the Rep uses, and their language ─────────────────────────────

export function proposeName(candidateId: string, name: string): { title: string; payload: string }[] | undefined {
  return name === candidateById(candidateId).name ? undefined : propose(candidateId, { type: 'name', name })
}

export function proposeLanguage(candidateId: string, locale: Locale): { title: string; payload: string }[] | undefined {
  return candidateById(candidateId).locale === locale ? undefined : propose(candidateId, { type: 'language', locale })
}

function propose(candidateId: string, change: ProfileChange): { title: string; payload: string }[] {
  const id = newId('prf').slice(4, 12)
  setAwaiting(candidateId, { kind: 'profile', id, change, until: new Date(Date.now() + HOURS_TO_ANSWER * 60 * 60 * 1000).toISOString() })
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const labels = change.type === 'retract' ? w.correctionButtons : w.profileButtons
  return [
    { title: labels.yes, payload: `pf:${id}:yes` },
    { title: labels.no, payload: `pf:${id}:no` },
  ]
}

// What the change waiting for their yes is, for the agent.
export function describeChange(change: ProfileChange): string {
  if (change.type === 'name') return `call them ${change.name}`
  if (change.type === 'language') return `talk to them in ${change.locale === 'es' ? 'Spanish' : 'English'}`
  return 'take what their correction makes untrue off their map'
}

export interface ProfileTap {
  id: string
  answer: 'yes' | 'no'
}

export function parseProfilePayload(value: string | null): ProfileTap | null {
  const match = value?.match(/^pf:(\w+):(yes|no)$/)
  return match ? { id: match[1], answer: match[2] as 'yes' | 'no' } : null
}

export async function answerProfile(candidateId: string, tap: ProfileTap, reply: Reply): Promise<void> {
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const awaiting = awaitingOf(candidateId)
  if (awaiting?.kind !== 'profile' || awaiting.id !== tap.id) {
    await reply(w.preferenceExpired)
    return
  }
  setAwaiting(candidateId, null)
  if (tap.answer === 'no') {
    await reply(w.profileKept)
    return
  }
  const { change } = awaiting
  if (change.type === 'name') {
    setCandidateName(candidateId, change.name)
    await reply(w.nameSaved(change.name))
    return
  }
  if (change.type === 'language') {
    chooseLocale(candidateId, change.locale)
    // Said in the language they chose.
    await reply(dictionaries[change.locale].whatsapp.languageSaved)
    return
  }
  // What it makes untrue goes now; their words are taken in after, and
  // what they added, if anything, comes in a message of its own.
  let turnId = ''
  withLocale(candidateLocale(candidateById(candidateId)), () => {
    turnId = takeCorrection(candidateId, change.items, change.words, afterTaken(candidateId, () => turnId, true)).turnId
  })
  await reply(w.correctionDone(mapLink(candidateId)))
}

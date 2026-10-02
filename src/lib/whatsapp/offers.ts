import { releaseDue } from '../matching/release'
import { applicationState, canFillForm, cancelApplication, fillApplication, filledPicture, submitApplication } from '../apply/browser'
import { cloudBrowserConfigured } from '../apply/cloud'
import { getPreparedApplication, prepareApplication } from '../apply/prepare'
import { issueAppLink } from '../auth/applinks'
import { getDb } from '../db/db'
import { getMatch, listMatchesForKey, respondToMatch, setProgress, type MatchListing, type MatchRow } from '../db/matching'
import { candidateById, isSearchPaused, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import type { Explanation } from '../matching/assess'
import { buildMatchingProfile } from '../matching/profile'
import { currentMatchKey, placeFit } from '../matching/run'
import { storedRoleQuery, type RoleQuery } from '../matching/role-query'
import { estimatesFor, payRank, shownEstimate, type ShownEstimate } from '../salary/estimate'
import { estimateRange, estimateSource } from '../salary/format'
import { logMessage } from './conversation'
import { linkOf, windowOpen, type WhatsAppLink } from './link'
import { wroteFirstRecently } from './proactive'
import { reviewForSending, type Pitch } from './review'
import { tellSent } from './sent'
import { sendTemplate, templatesEnabled } from './templates'
import { sendMessage, sendPicture, zernioConfig, type ZernioConfig } from './zernio'

// Offers on WhatsApp: only what the first reading found to be their kind of
// role, and only after a second reading finds nothing that would let them
// down. No quota: what goes out is decided by fit. Only a pace, so they never
// arrive in a burst: at most one a day, and only on a day amble has not
// written first already (proactive.ts), at a decent hour. The rest waits in
// the app. Each comes with three answers; what they say is kept exactly as in
// the app, and a "no" asks why, so the Rep learns from it.

const PER_DAY = 1
const HOURS_APART = 3
const SEND_FROM_HOUR = 9
const SEND_UNTIL_HOUR = 21
// Second readings per person per run: each is a model call.
const REVIEWS_PER_RUN = 4

type Listed = MatchRow & MatchListing & { estimate: ShownEstimate | null }

function madridHour(date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(date))
}

// Into their own account, signed in, at that page.
export function appUrl(candidateId: string, route: string): string {
  return issueAppLink(candidateId, route)
}

function paceAllows(candidateId: string): boolean {
  const db = getDb()
  const sentToday = db
    .prepare('SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM offer_sends WHERE candidate_id = ? AND sent_at >= ?')
    .get(candidateId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as { n: number; last: string | null }
  if (sentToday.n >= PER_DAY) return false
  return !sentToday.last || Date.now() - Date.parse(sentToday.last) >= HOURS_APART * 60 * 60 * 1000
}

// What the first reading found to be their kind of role, open, unanswered,
// never read a second time: nearest first (their city or country, then open
// to them, then elsewhere in Europe, then outside it); within that, offers
// that publish a salary, then those whose estimated pay reaches their floor,
// then those with nothing known, then those estimated below it; then newest.
function candidatesToSend(candidateId: string, floor: { amount: number; currency: string } | null, query: RoleQuery | null): Listed[] {
  const db = getDb()
  const considered = new Set(
    (db.prepare('SELECT match_id FROM offer_sends WHERE candidate_id = ?').all(candidateId) as unknown as { match_id: string }[]).map((row) => row.match_id),
  )
  const decided = new Set(
    (db.prepare('SELECT opportunity_id FROM opportunity_decisions WHERE candidate_id = ?').all(candidateId) as unknown as { opportunity_id: string }[]).map(
      (row) => row.opportunity_id,
    ),
  )
  // Only what has been given to them: the same few a day as on the screens.
  const released = releaseDue(candidateId)
  const seenRoles = new Set<string>()
  const picked: (MatchRow & MatchListing)[] = []
  for (const match of listMatchesForKey(candidateId, currentMatchKey(candidateId))) {
    // One role posted in several cities is one message.
    const role = match.model_run_id ?? match.id
    if (seenRoles.has(role)) continue
    seenRoles.add(role)
    if (match.verdict !== 'show' || match.closed_at || match.response || considered.has(match.id) || decided.has(match.opportunity_id)) continue
    if (!released.has(match.opportunity_id)) continue
    const explanation = JSON.parse(match.explanation) as Explanation
    if (explanation.roleFit.fit !== 'fits') continue
    picked.push(match)
  }
  const estimates = estimatesFor(picked.map((match) => match.opportunity_id))
  const listed = picked.map((match) => ({
    ...match,
    estimate: publishedSalary(match) ? null : shownEstimate(estimates.get(match.opportunity_id), floor),
  }))
  const rank = (match: Listed) => payRank({ salary: publishedSalary(match), estimate: match.estimate })
  const near = (match: Listed) => (query ? placeFit(match.location, query) : 1)
  return listed.sort((a, b) => near(a) - near(b) || rank(b) - rank(a) || b.created_at.localeCompare(a.created_at))
}

function publishedSalary(match: MatchListing): string | null {
  return match.salary_raw ?? (match.salary_min ? `${match.salary_min}–${match.salary_max ?? '?'} ${match.salary_currency ?? ''}`.trim() : null)
}

// A few of the places it lists: the rest is in the app.
const PLACES_SHOWN = 3

// Exported for the script that shows what a message reads like.
export function offerText(match: Listed, pitch: Pitch | null, d: (typeof dictionaries)['es']): string {
  const w = d.whatsapp
  const explanation = JSON.parse(match.explanation) as Explanation
  // Always a line on pay: as published; otherwise the table's estimate, said
  // to be one, with its source; otherwise that it is not published.
  const published = publishedSalary(match)
  const salary = published
    ? w.salaryPublished(published)
    : match.estimate
      ? w.salaryEstimated(estimateRange(match.estimate), estimateSource(match.estimate, d.salaryEstimate))
      : w.salaryUnknown
  const places = (match.location ?? '').split(' · ').filter(Boolean)
  const shownPlaces = places.length > PLACES_SHOWN ? `${places.slice(0, PLACES_SHOWN).join(' · ')}…` : places.join(' · ')
  const where = [shownPlaces, match.workplace ? (w.workplace[match.workplace as keyof typeof w.workplace] ?? null) : null].filter(Boolean).join(' · ')
  return [
    `*${match.title}*`,
    `${match.company_name}${where ? ` · ${where}` : ''}`,
    salary,
    match.estimate?.belowFloor ? d.salaryEstimate.belowFloor(estimateRange({ min: match.estimate.belowFloor, max: match.estimate.belowFloor })) : null,
    '',
    pitch?.summary ?? explanation.summary,
    ...(pitch?.reasons ?? explanation.why.slice(0, 3).map((reason) => reason.text)).map((reason) => `• ${reason}`),
    // The offer itself, to read in full.
    match.url ? `\n${w.offerLink}: ${match.url}` : null,
  ]
    .filter((line): line is string => line !== null && line !== undefined)
    .join('\n')
}

async function sendOne(config: ZernioConfig, link: WhatsAppLink, match: Listed, pitch: Pitch | null): Promise<void> {
  const d = dictionaries[candidateLocale(candidateById(link.candidate_id))]
  const w = d.whatsapp
  const body = offerText(match, pitch, d)
  await sendMessage(config, {
    conversationId: link.conversation_id as string,
    text: body,
    buttons: [
      { title: w.offerButtons.interested, payload: `of:${match.id}:interested` },
      { title: w.offerButtons.notFit, payload: `of:${match.id}:not_fit` },
      { title: w.offerButtons.more, payload: `of:${match.id}:more` },
    ],
    idempotencyKey: `of:${match.id}`,
  })
  getDb().prepare('UPDATE offer_sends SET sent_at = ? WHERE candidate_id = ? AND match_id = ?').run(now(), link.candidate_id, match.id)
  logMessage(link.candidate_id, 'out', body)
}

// "Cuéntame" on the offer's template: the offer itself, as reviewed when
// the template went out. False when it is no longer there to show.
export async function showTeasedOffer(candidateId: string, matchId: string): Promise<boolean> {
  const config = zernioConfig()
  const link = linkOf(candidateId)
  if (!config || !link?.conversation_id) return false
  const match = listMatchesForKey(candidateId, currentMatchKey(candidateId)).find((row) => row.id === matchId)
  if (!match || match.closed_at) return false
  const sent = getDb().prepare('SELECT pitch FROM offer_sends WHERE candidate_id = ? AND match_id = ?').get(candidateId, matchId) as { pitch: string | null } | undefined
  const floor = storedRoleQuery(candidateId, buildMatchingProfile(candidateId))?.salaryFloor ?? null
  const estimate = publishedSalary(match) ? null : shownEstimate(estimatesFor([match.opportunity_id]).get(match.opportunity_id), floor)
  await sendOne(config, link, { ...match, estimate }, sent?.pitch ? (JSON.parse(sent.pitch) as Pitch) : null)
  return true
}

export interface OfferStats {
  sent: number
  held: number
  skipped: { candidateId: string; reason: string }[]
}

// For everyone with WhatsApp linked, or for one person: the next offer that
// passes the second reading, if the pace allows one now.
export async function sendDueOffers(onlyCandidateId?: string): Promise<OfferStats> {
  const stats: OfferStats = { sent: 0, held: 0, skipped: [] }
  const config = zernioConfig()
  if (!config) return stats
  const hour = madridHour()
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return stats
  const ids = onlyCandidateId
    ? [onlyCandidateId]
    : (getDb().prepare('SELECT candidate_id FROM whatsapp_links WHERE conversation_id IS NOT NULL').all() as unknown as { candidate_id: string }[]).map(
        (row) => row.candidate_id,
      )
  for (const candidateId of ids) {
    const link = linkOf(candidateId)
    // Paused: nothing goes out until they resume it.
    if (!link?.conversation_id || isSearchPaused(candidateId) || !paceAllows(candidateId) || wroteFirstRecently(candidateId)) continue
    // Outside the 24 hours an offer goes as the approved template that asks
    // first; the shared test number has none.
    const open = windowOpen(link)
    if (!open && (!templatesEnabled() || config.sandbox)) {
      stats.skipped.push({ candidateId, reason: 'window closed: an offer needs a template' })
      continue
    }
    const profile = buildMatchingProfile(candidateId)
    const query = storedRoleQuery(candidateId, profile)
    const floor = query?.salaryFloor ?? null
    let reviews = 0
    for (const match of candidatesToSend(candidateId, floor, query)) {
      if (reviews >= REVIEWS_PER_RUN) break
      reviews++
      try {
        const review = await reviewForSending({ candidateId, match, profile })
        getDb()
          .prepare(
            'INSERT OR REPLACE INTO offer_sends (candidate_id, match_id, opportunity_id, reviewed_at, decision, reason, model_run_id, pitch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            candidateId,
            match.id,
            match.opportunity_id,
            now(),
            review.send ? 'send' : 'hold',
            review.reason,
            review.modelRunId,
            review.pitch ? JSON.stringify(review.pitch) : null,
          )
        if (!review.send) {
          stats.held++
          continue
        }
        if (open) await sendOne(config, link, match, review.pitch)
        else {
          await sendTemplate(config, link, 'offer', [], [`tpl:of:${match.id}`, null], `tpl-of:${match.id}`)
          // Counted for the pace now; the whole offer follows their tap.
          getDb().prepare('UPDATE offer_sends SET sent_at = ? WHERE candidate_id = ? AND match_id = ?').run(now(), candidateId, match.id)
        }
        stats.sent++
        break
      } catch (error) {
        stats.skipped.push({ candidateId, reason: error instanceof Error ? error.message : String(error) })
        break
      }
    }
  }
  return stats
}

// ── What they answer ──────────────────────────────────────────────────────

export type OfferTap =
  | { kind: 'offer'; matchId: string; answer: 'interested' | 'not_fit' | 'more' }
  | { kind: 'apply'; matchId: string; answer: 'yes' | 'no' }
  // Fill the prepared application in the company's own form, in the cloud.
  | { kind: 'fill'; matchId: string; answer: 'yes' | 'no' }
  // On the picture of the filled form.
  | { kind: 'send'; matchId: string; answer: 'yes' | 'look' | 'no' }

export function parseOfferPayload(value: string | null): OfferTap | null {
  const offer = value?.match(/^of:([\w-]+):(interested|not_fit|more)$/)
  if (offer) return { kind: 'offer', matchId: offer[1], answer: offer[2] as 'interested' | 'not_fit' | 'more' }
  const apply = value?.match(/^ap:([\w-]+):(yes|no)$/)
  if (apply) return { kind: 'apply', matchId: apply[1], answer: apply[2] as 'yes' | 'no' }
  const fill = value?.match(/^af:([\w-]+):(yes|no)$/)
  if (fill) return { kind: 'fill', matchId: fill[1], answer: fill[2] as 'yes' | 'no' }
  const send = value?.match(/^as:([\w-]+):(yes|look|no)$/)
  if (send) return { kind: 'send', matchId: send[1], answer: send[2] as 'yes' | 'look' | 'no' }
  return null
}

export type Awaiting =
  | { kind: 'offer_reason'; matchId: string; until: string }
  // A change to what it listens for, proposed by the agent, waiting for a yes
  // on its own buttons (the id), and the rule of theirs it would replace.
  | { kind: 'preference'; id?: string; preference: ProposedPreference; until: string }
  // Pausing the search, or resuming it, proposed by the agent on their word
  // and waiting for a yes on its own buttons.
  | { kind: 'pause'; id: string; pause: boolean; until: string; checkIn?: string | null }

export interface ProposedPreference {
  kind: 'hard_filter' | 'compensation' | 'strong'
  label: string
  statement: string
  replaces: string | null
  // Whether it rules offers out or only weighs is theirs to say: two buttons.
  either?: boolean
}

export function awaitingOf(candidateId: string): Awaiting | null {
  const row = getDb().prepare('SELECT awaiting FROM whatsapp_links WHERE candidate_id = ?').get(candidateId) as { awaiting: string | null } | undefined
  if (!row?.awaiting) return null
  const awaiting = JSON.parse(row.awaiting) as Awaiting
  return Date.parse(awaiting.until) > Date.now() ? awaiting : null
}

export function setAwaiting(candidateId: string, awaiting: Awaiting | null): void {
  getDb().prepare('UPDATE whatsapp_links SET awaiting = ? WHERE candidate_id = ?').run(awaiting ? JSON.stringify(awaiting) : null, candidateId)
}

function answered(candidateId: string, matchId: string, answer: string): void {
  getDb().prepare('UPDATE offer_sends SET answer = ?, answered_at = ? WHERE candidate_id = ? AND match_id = ?').run(answer, now(), candidateId, matchId)
}

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

export async function handleOfferTap(candidateId: string, tap: OfferTap, reply: Reply): Promise<void> {
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const match = getMatch(tap.matchId)
  // A button from an offer amble no longer has: said, not left unanswered.
  if (!match || match.candidate_id !== candidateId) {
    await reply(w.tapExpired)
    return
  }
  const explanation = JSON.parse(match.explanation) as Explanation

  if (tap.kind === 'offer' && tap.answer === 'interested') {
    respondToMatch(match.id, candidateId, 'interested', null)
    answered(candidateId, match.id, 'interested')
    await reply(w.offerInterested, [
      { title: w.applyButtons.yes, payload: `ap:${match.id}:yes` },
      { title: w.applyButtons.no, payload: `ap:${match.id}:no` },
    ])
    return
  }
  if (tap.kind === 'offer' && tap.answer === 'not_fit') {
    respondToMatch(match.id, candidateId, 'not_for_me', null)
    answered(candidateId, match.id, 'not_fit')
    setAwaiting(candidateId, { kind: 'offer_reason', matchId: match.id, until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
    await reply(w.offerNotFit)
    return
  }
  if (tap.kind === 'offer' && tap.answer === 'more') {
    // What could make it a no, as the second reading told it to them.
    const stored = getDb().prepare('SELECT pitch FROM offer_sends WHERE candidate_id = ? AND match_id = ?').get(candidateId, match.id) as
      | { pitch: string | null }
      | undefined
    const pitch = stored?.pitch ? (JSON.parse(stored.pitch) as Pitch) : null
    const caveat = pitch ? pitch.caveat : (explanation.considerAlso?.text ?? null)
    const lines = [
      caveat ? `*${w.considerAlso}*\n${caveat}` : null,
      explanation.unknowns.length > 0 ? `\n*${w.unknowns}*\n${explanation.unknowns.slice(0, 3).map((unknown) => `• ${unknown}`).join('\n')}` : null,
      `\n${w.inApp}: ${appUrl(candidateId, '/opportunities?tab=new')}`,
    ].filter(Boolean)
    await reply(lines.join('\n'), [
      { title: w.offerButtons.interested, payload: `of:${match.id}:interested` },
      { title: w.offerButtons.notFit, payload: `of:${match.id}:not_fit` },
    ])
    return
  }
  if (tap.kind === 'apply' && tap.answer === 'no') {
    await reply(w.applyLater(appUrl(candidateId, '/opportunities?tab=wanted')))
    return
  }
  // Sent already (an older button pressed later): nothing to prepare.
  const applied = (
    getDb().prepare('SELECT progress FROM opportunity_decisions WHERE candidate_id = ? AND opportunity_id = ?').get(candidateId, match.opportunity_id) as
      | { progress: string | null }
      | undefined
  )?.progress === 'applied'
  if (tap.kind === 'apply' && tap.answer === 'yes' && applied) {
    await reply(w.alreadyApplied)
    return
  }
  if (tap.kind === 'apply' && tap.answer === 'yes') {
    await reply(w.applyWorking)
    try {
      const prepared = await prepareApplication(candidateId, match.opportunity_id)
      // How to send it, in a line of its own (the reasoning is in the app),
      // and what to lead with.
      const emphasise = prepared.advice.emphasise.slice(0, 3).map((point) => `• ${point}`)
      const summary = [
        `${w.applyReady} ${w.applyChannel[prepared.advice.channel] ?? ''}`.trim(),
        ...(emphasise.length > 0 ? ['', w.applyLead, ...emphasise] : []),
        '',
      ]
      // With a browser in the cloud, amble can fill the company's own form.
      if (cloudBrowserConfigured() && canFillForm(match.opportunity_id)) {
        await reply([...summary, w.fillOffer].join('\n'), [
          { title: w.fillButtons.yes, payload: `af:${match.id}:yes` },
          { title: w.fillButtons.no, payload: `af:${match.id}:no` },
        ])
      } else {
        await reply([...summary, w.applyFinish(appUrl(candidateId, '/opportunities?tab=wanted'))].join('\n'))
      }
    } catch {
      await reply(w.applyFailed(appUrl(candidateId, '/opportunities?tab=wanted')))
    }
    return
  }
  if (tap.kind === 'fill' && tap.answer === 'no') {
    await reply(w.applyLater(appUrl(candidateId, '/opportunities?tab=wanted')))
    return
  }
  if (tap.kind === 'fill' && tap.answer === 'yes') {
    const wanted = appUrl(candidateId, '/opportunities?tab=wanted')
    if (applied) {
      await reply(w.alreadyApplied)
      return
    }
    // Nothing prepared yet: that comes first.
    if (!getPreparedApplication(candidateId, match.opportunity_id)) {
      await reply(w.fillNeedsPrepare, [
        { title: w.applyButtons.yes, payload: `ap:${match.id}:yes` },
        { title: w.applyButtons.no, payload: `ap:${match.id}:no` },
      ])
      return
    }
    // Filled from WhatsApp only in a browser in the cloud, never on the server.
    if (!cloudBrowserConfigured()) {
      await reply(w.fillUnavailable(wanted))
      return
    }
    await reply(w.fillWorking)
    try {
      const result = await fillApplication(candidateId, match.opportunity_id, 'whatsapp')
      if (result.status === 'missing') {
        await reply(w.fillMissing(result.missing.slice(0, 5), wanted))
        return
      }
      if (result.status !== 'filled' || !result.live) {
        await reply(w.fillFailed(appUrl(candidateId, '/opportunities?tab=wanted')))
        return
      }
      const live = appUrl(candidateId, `/apply/live?o=${encodeURIComponent(match.opportunity_id)}`)
      // Everything filled: a picture of how it looks, and it goes on their
      // yes. A "not a robot" check, if the form asks for one when sending, is
      // theirs then, in the live view. Anything left: theirs to finish there.
      const picture = result.left.length === 0 ? filledPicture(candidateId, match.opportunity_id) : null
      const config = zernioConfig()
      const link = linkOf(candidateId)
      if (picture && config && link?.conversation_id) {
        await sendPicture(config, {
          conversationId: link.conversation_id,
          image: picture,
          filename: 'formulario.jpg',
          text: w.fillReady,
          buttons: [
            { title: w.sendButtons.yes, payload: `as:${match.id}:yes` },
            { title: w.sendButtons.look, payload: `as:${match.id}:look` },
            { title: w.sendButtons.no, payload: `as:${match.id}:no` },
          ],
          idempotencyKey: `fillready:${match.id}:${new Date().toISOString().slice(0, 16)}`,
        })
        logMessage(candidateId, 'out', w.fillReady)
        return
      }
      await reply([w.fillDone(result.filled.length, result.left, live), result.captcha ? w.fillCaptcha : null].filter(Boolean).join('\n\n'))
    } catch {
      await reply(w.fillFailed(appUrl(candidateId, '/opportunities?tab=wanted')))
    }
    return
  }
  // On the picture of the filled form: send it, look at it, or leave it.
  if (tap.kind === 'send') {
    const wanted = appUrl(candidateId, '/opportunities?tab=wanted')
    const live = appUrl(candidateId, `/apply/live?o=${encodeURIComponent(match.opportunity_id)}`)
    if (applied) {
      await reply(w.alreadyApplied)
      return
    }
    const refill = [
      { title: w.fillButtons.yes, payload: `af:${match.id}:yes` },
      { title: w.fillButtons.no, payload: `af:${match.id}:no` },
    ]
    if (tap.answer === 'no') {
      await cancelApplication(candidateId, match.opportunity_id)
      await reply(w.sendCancelled(wanted))
      return
    }
    // The form closed meanwhile (left too long, or the server restarted).
    if (applicationState(candidateId, match.opportunity_id) !== 'open') {
      await reply(w.sendExpired, refill)
      return
    }
    if (tap.answer === 'look') {
      await reply(w.sendLook(live))
      return
    }
    // Their tap on "Send it", under the picture of what goes: the yes it needs.
    await reply(w.sendWorking)
    const result = await submitApplication(candidateId, match.opportunity_id)
    if (result.status === 'sent') {
      setProgress(candidateId, [match.opportunity_id], 'applied')
      await tellSent(candidateId, match.opportunity_id)
      return
    }
    if (result.status === 'expired') {
      await reply(w.sendExpired, refill)
      return
    }
    await reply(w.sendBlocked[result.reason](live))
  }
}

// The offer they just said does not fit, while amble waits to hear why.
export function awaitedReason(candidateId: string): { matchId: string; company: string; title: string } | null {
  const awaiting = awaitingOf(candidateId)
  if (awaiting?.kind !== 'offer_reason') return null
  const row = getDb()
    .prepare('SELECT o.title, c.name AS company FROM opportunity_matches m JOIN opportunities o ON o.id = m.opportunity_id JOIN companies c ON c.id = o.company_id WHERE m.id = ?')
    .get(awaiting.matchId) as { title: string; company: string } | undefined
  return row ? { matchId: awaiting.matchId, company: row.company, title: row.title } : null
}

// Their words after a "doesn't fit", when they say why (the agent tells
// that from a question or anything else): kept on their answer. Either way
// it is no longer awaited: a later message is not taken for the reason.
export function settleAwaitedReason(candidateId: string, matchId: string, reason: string | null): void {
  if (reason) respondToMatch(matchId, candidateId, 'not_for_me', reason.slice(0, 1000))
  const awaiting = awaitingOf(candidateId)
  if (awaiting?.kind === 'offer_reason' && awaiting.matchId === matchId) setAwaiting(candidateId, null)
}

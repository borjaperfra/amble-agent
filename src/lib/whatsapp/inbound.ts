import { getDb } from '../db/db'
import { getCandidate, getUncertainty, isSearchPaused, now, type CandidateRow } from '../db/repo'
import { emailOwnerAbout, feedbackToday, recordFeedback } from '../feedback'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { MAX_AUDIO_BYTES, transcribe } from '../model/transcribe'
import { companyAction, connectApp, offerToShow, runAction } from './actions'
import { answerInterviewQuestion, pendingInterviewQuestion, sendTeasedQuestion } from './interview'
import { leaveReminder, sendTeasedReminder } from './reminders'
import { judgeShared, pastedOffer, readSharedLink, type SharedVerdict } from './shared'
import { answerMessage, languageOf, mapGapsOf } from './agent'
import { logMessage } from './conversation'
import { answerFollowup, parseFollowupPayload } from './followups'
import { linkBySender, saveLink, takeLinkCode, touchLink } from './link'
import { awaitedReason, handleOfferTap, parseOfferPayload, pickFromDigest, sendDigest, sendDueOffers, settleAwaitedReason, showTeasedOffer } from './offers'
import { templateTap } from './templates'
import { answerPause, parsePausePayload, proposePause } from './pause'
import { answerPreference, parsePreferencePayload, proposePreference } from './preferences'
import { getMatch } from '../db/matching'
import { readNo } from '../pipeline/learn-from-no'
import { answerProfile, parseProfilePayload, proposeCorrection, proposeLanguage, proposeName, takeGap, takeNote } from './profile'
import { documentName, isDocument, takeDocument, takeLink, type SentAttachment } from './documents'
import { isMaliciousLink } from '../net/reputation'
import type { RawOpportunity } from '../sourcing/types'
import { untrusted } from '../untrusted'
import { allow } from './throttle'
import { fetchMedia, markRead, react, sendMessage, showTyping, zernioConfig } from './zernio'

// One event from the provider's webhook. Each is handled once (they retry
// until answered, with the same id). What someone writes is, in order: the
// code that links their number; a tap on a button (an offer, a question
// about an application, a proposed change); the reason after a "doesn't
// fit"; or words, which the agent answers. What is about amble itself also
// reaches the owner. Everything said, both ways, is kept.

interface InboundEvent {
  id: string
  event: string
  message?: {
    conversationId: string
    platform: string
    direction: string
    text: string | null
    platformMessageId?: string
    attachments?: unknown[]
    sender: { id: string; phoneNumber?: string | null; businessScopedUserId?: string }
  }
  // buttonPayload: a tap on a template's button (a plain button reply, not an interactive one).
  metadata?: { interactiveId?: string; buttonPayload?: string } | null
  // The number it reached: production's, or the shared sandbox staging uses.
  account?: { id?: string; accountId?: string } | null
}

// Where to start, said to a number amble does not know: once in a while,
// not to every message a script sends.
const STRANGER_REPLIES = 2
const STRANGER_WINDOW_MS = 6 * 60 * 60 * 1000

export async function handleEvent(event: InboundEvent): Promise<void> {
  // Without its id an event could not be handled only once.
  if (typeof event?.id !== 'string' || !event.id) return
  const db = getDb()
  const seen = db.prepare('INSERT OR IGNORE INTO whatsapp_events (id, event, received_at) VALUES (?, ?, ?)').run(event.id, event.event, now())
  if (seen.changes === 0) return
  if (event.event !== 'message.received') return
  const message = event.message
  if (!message || message.platform !== 'whatsapp' || message.direction !== 'incoming' || typeof message.conversationId !== 'string' || !message.sender) return
  const config = zernioConfig()
  if (!config) return
  // Zernio's webhooks get every account's messages: production and staging
  // each answer only what reached their own number.
  const reached = event.account?.accountId ?? event.account?.id
  if (reached && reached !== config.accountId) return

  // WhatsApp's own id for the person, when it comes; the number otherwise.
  const phone = (message.sender.phoneNumber ?? `+${message.sender.id}`).replace(/[^\d+]/g, '')
  const userId = message.sender.businessScopedUserId ?? null
  const text = typeof message.text === 'string' ? message.text.trim() : ''
  const interactiveId = event.metadata?.interactiveId ?? null

  // Each reply its own key: one event can be answered in several messages.
  let replies = 0
  let replyTo: string | null = null
  const reply: Reply = async (body, buttons) => {
    await sendMessage(config, { conversationId: message.conversationId, text: body, buttons, idempotencyKey: `reply:${event.id}:${replies++}` })
    if (replyTo) logMessage(replyTo, 'out', body)
  }

  const linkingCandidate = text ? takeLinkCode(text, userId ?? phone) : null
  if (linkingCandidate) {
    saveLink(linkingCandidate, { phone, userId, conversationId: message.conversationId })
    replyTo = linkingCandidate
    const candidate = getCandidate(linkingCandidate)
    await reply(dictionaries[candidateLocale(candidate ?? null)].whatsapp.linked(candidate?.name ?? null))
    // What it has already found, now that it can say so.
    await sendDueOffers(linkingCandidate)
    return
  }

  const link = linkBySender({ userId, phone })
  if (!link) {
    // Someone amble does not know: where to start, and nothing more.
    if (allow('stranger', userId ?? phone, STRANGER_REPLIES, STRANGER_WINDOW_MS)) {
      await reply(`${dictionaries.es.whatsapp.unknown}\n\n${dictionaries.en.whatsapp.unknown}`)
    }
    return
  }
  touchLink(link.candidate_id, message.conversationId)
  // Seen, at once: the blue ticks.
  void markRead(config, message.conversationId).catch(() => undefined)
  const candidate = getCandidate(link.candidate_id)
  if (!candidate) return
  replyTo = candidate.id

  const attachments = (message.attachments as (SentAttachment & { type?: string; url?: string; mimeType?: string })[] | undefined) ?? []
  const fromZernio = (attachment: SentAttachment & { url?: string; mimeType?: string }): IncomingFile => ({
    name: documentName(attachment),
    mimeType: attachment.mimeType ?? null,
    fetch: (maxBytes) => fetchMedia(config, attachment.url ?? '', maxBytes),
  })
  const document = attachments.find(isDocument)
  const voice = attachments.find((item) => item.type === 'audio' && item.url)
  return handleFromPerson(
    candidate,
    {
      text,
      interactiveId,
      buttonPayload: event.metadata?.buttonPayload ?? null,
      document: document ? fromZernio(document) : null,
      voice: voice ? { name: 'voice', mimeType: voice.mimeType ?? 'audio/ogg', fetch: (maxBytes) => fetchZernioVoice(config.apiKey, voice.url ?? '', maxBytes) } : null,
      otherAttachment: attachments.length > 0,
    },
    {
      reply,
      typing: () => void showTyping(config, message.conversationId).catch(() => undefined),
      react: (emoji) => {
        if (message.platformMessageId) void react(config, message.conversationId, message.platformMessageId, emoji).catch(() => undefined)
      },
    },
  )
}

// What someone wrote, on any channel (WhatsApp, Telegram), once it is known
// whose it is: the words, a tapped button, a document or a voice note.
export interface IncomingFile {
  name: string
  mimeType: string | null
  // Its bytes, whole or not at all (TooLargeError past maxBytes); null when gone.
  fetch(maxBytes: number): Promise<Buffer | null>
}

export interface PersonMessage {
  text: string
  // The payload of a button they tapped.
  interactiveId: string | null
  // WhatsApp only: the words of a template's button.
  buttonPayload: string | null
  document: IncomingFile | null
  voice: IncomingFile | null
  // Something else came with it (a picture): not read yet.
  otherAttachment: boolean
}

// How to answer on the channel it came from.
export interface ChatIO {
  reply: Reply
  typing(): void
  react(emoji: string): void
}

export async function handleFromPerson(candidate: CandidateRow, input: PersonMessage, io: ChatIO): Promise<void> {
  const { text } = input
  const reply = io.reply
  let interactiveId = input.interactiveId
  const w = dictionaries[candidateLocale(candidate)].whatsapp

  // A template's button: what it stands for. "Not now" is acknowledged; the
  // offer, the reminder or the question it announced follows the tap; the
  // rest answer as the ordinary message's buttons would.
  const fromTemplate = templateTap(candidate.id, input.buttonPayload, text)
  if (fromTemplate !== null) {
    if (fromTemplate === '') {
      logMessage(candidate.id, 'in', text)
      await reply(w.templateNotNow)
      return
    }
    if (fromTemplate.startsWith('tpl:of:') || fromTemplate.startsWith('tpl:od:') || fromTemplate.startsWith('tpl:rem:') || fromTemplate === 'tpl:question') {
      logMessage(candidate.id, 'in', text)
      const shown = fromTemplate.startsWith('tpl:of:')
        ? await showTeasedOffer(candidate.id, fromTemplate.slice('tpl:of:'.length))
        : fromTemplate.startsWith('tpl:od:')
          ? await sendDigest(candidate.id, fromTemplate.slice('tpl:od:'.length))
        : fromTemplate.startsWith('tpl:rem:')
          ? await sendTeasedReminder(candidate.id, fromTemplate.slice('tpl:rem:'.length))
          : await sendTeasedQuestion(candidate.id)
      if (!shown) await reply(w.tapExpired)
      return
    }
    interactiveId = fromTemplate
  }

  const offerTap = parseOfferPayload(interactiveId)
  if (offerTap) {
    logMessage(candidate.id, 'in', text)
    await handleOfferTap(candidate.id, offerTap, reply)
    return
  }
  const followupTap = parseFollowupPayload(interactiveId)
  if (followupTap) {
    logMessage(candidate.id, 'in', text)
    const thanks = answerFollowup(candidate.id, followupTap)
    // A question amble no longer has: said, not left unanswered.
    await reply(thanks ?? w.tapExpired)
    return
  }
  const preferenceTap = parsePreferencePayload(interactiveId)
  if (preferenceTap) {
    logMessage(candidate.id, 'in', text)
    await answerPreference(candidate.id, preferenceTap, reply)
    return
  }
  const pauseTap = parsePausePayload(interactiveId)
  if (pauseTap) {
    logMessage(candidate.id, 'in', text)
    await answerPause(candidate.id, pauseTap, reply)
    return
  }
  const profileTap = parseProfilePayload(interactiveId)
  if (profileTap) {
    logMessage(candidate.id, 'in', text)
    await answerProfile(candidate.id, profileTap, reply)
    return
  }

  // A document (a new CV, their LinkedIn PDF) is read into their map,
  // whatever words come with it.
  if (input.document) {
    logMessage(candidate.id, 'in', text || `[${input.document.name}]`)
    io.typing()
    await takeDocument(candidate, input.document, reply)
    return
  }

  // A voice note is heard as what it says; a picture is not read yet.
  if (!text) {
    if (input.voice) {
      const heard = await hear(input.voice, candidateLocale(candidate)).catch(() => '')
      if (heard) return answerWords(candidate, heard, reply, w, io)
      await reply(w.voiceFailed)
      return
    }
    if (input.otherAttachment) await reply(w.textOnly)
    return
  }

  return answerWords(candidate, text, reply, w, io)
}

type Reply = (body: string, buttons?: { title: string; payload: string }[]) => Promise<void>

// Words, typed or spoken: the reason awaited after a "doesn't fit", or else
// the agent's to answer.
// While the agent thinks: "typing…" on their screen, renewed as it lasts
// (WhatsApp shows it for 25 seconds), and after a few seconds a short line
// saying the answer is on its way.
const HOLD_AFTER_MS = 12_000
// How much of a page that is not marked as an offer the agent reads to tell what it is.
const PAGE_LINES = 800
const TYPING_EVERY_MS = 20_000

async function answerWords(
  candidate: CandidateRow,
  message: string,
  reply: Reply,
  w: (typeof dictionaries)['es']['whatsapp'],
  chat: ChatIO,
): Promise<void> {
  let text = message
  // What they wrote, before any note of amble's is added to it.
  const language = languageOf(message)
  // Right after a "doesn't fit", amble waits to hear why; the agent tells
  // the reason from anything else they write.
  const awaited = awaitedReason(candidate.id)

  // Numbers back to the day's list (#51): those offers, in full, with no
  // model in between. Not while amble waits to hear why one did not fit.
  const picked = awaited ? null : await pickFromDigest(candidate.id, text)
  if (picked !== null) {
    logMessage(candidate.id, 'in', text)
    // What they picked closed since: said, not left unanswered.
    if (picked === 0) await reply(w.tapExpired)
    return
  }

  // A person writes a message now and then; a flood is not a conversation.
  if (overLimit(candidate.id)) {
    logMessage(candidate.id, 'in', text)
    await reply(w.tooMany)
    return
  }

  const typing = () => chat.typing()
  typing()

  // A link to an offer: read and judged like any offer amble finds. A page
  // that does not mark itself as one (a portfolio, a post, a project of
  // theirs, or an offer that does not say so) goes to the agent, who tells
  // which: an offer is judged, their own work is read into their map.
  const link = text.match(/https?:\/\/[^\s<>"]+/)?.[0]
  let page: RawOpportunity | null = null
  if (link) {
    const shared = await readSharedLink(link).catch(() => null)
    if (shared?.kind === 'posting') {
      if (awaited) settleAwaitedReason(candidate.id, awaited.matchId, null)
      logMessage(candidate.id, 'in', text)
      await reply(w.sharedReading)
      const verdict = await judgeShared(candidate.id, shared.offer).catch(() => null)
      if (!verdict) {
        await reply(w.agentFailed)
        return
      }
      const shown = presentVerdict(verdict, w)
      await reply(shown.text, shown.buttons)
      return
    }
    if (shared) {
      page = shared.offer
      text = `${text}\n\n(amble read that link; it does not mark itself as a job offer. Its title and first lines:)\n${untrusted('page', `${page.title}\n${(page.description ?? '').slice(0, PAGE_LINES)}`)}`
    }
  }
  if (link && !page) {
    // Not readable (a page behind a sign-in, for one): the agent asks for the
    // text. One known to spread malware was never opened, and they hear why.
    text = (await isMaliciousLink(link).catch(() => false))
      ? `${text}\n\n(amble did not open that link: it is on a public list of links known to spread malware.)`
      : `${text}\n\n(amble could not read that link.)`
  }
  const typingTimer = setInterval(typing, TYPING_EVERY_MS)
  // The line saying it is on its way goes only if the answer is slow, and
  // always before the answer, never after it.
  let holding: Promise<unknown> | null = null
  // In the language of their message, as the answer will be.
  const holdLine = dictionaries[language ?? candidateLocale(candidate)].whatsapp.thinking
  const holdTimer = setTimeout(() => {
    holding = reply(holdLine).catch(() => undefined)
  }, HOLD_AFTER_MS)
  // The agent reads the conversation so far, then this message joins it.
  const answer = await answerMessage(candidate.id, text, language).catch(() => null)
  clearTimeout(holdTimer)
  clearInterval(typingTimer)
  if (holding) await holding
  logMessage(candidate.id, 'in', text)
  if (answer?.reaction) chat.react(answer.reaction)
  if (!answer) {
    await reply(w.agentFailed)
    return
  }
  if (awaited) settleAwaitedReason(candidate.id, awaited.matchId, answer.reasonItDoesNotFit)
  let buttons = answer.intent === 'preferences' && answer.preference ? proposePreference(candidate.id, answer.preference) : undefined
  // A pasted offer, or a page the agent read as one: judged after the
  // agent's line that it is reading it.
  if (answer.action?.type === 'evaluate_posting') {
    // One line that it is reading it: the verdict says the rest, once.
    await reply(w.sharedReading)
    const offer = page
      ? { ...page, companyName: answer.action.company || page.companyName, title: answer.action.title || page.title }
      : pastedOffer(text, answer.action.company, answer.action.title)
    const verdict = await judgeShared(candidate.id, offer).catch(() => null)
    const shown = verdict ? presentVerdict(verdict, w) : { text: w.agentFailed, buttons: undefined }
    await reply(shown.text, shown.buttons)
    return
  }
  // A page of their own work: read into their map, with its own lines on
  // what it added. Only a page amble could read: the agent's line would
  // promise a reading that never comes.
  if (answer.action?.type === 'read_link') {
    if (page && link) await takeLink(candidate, link, reply)
    else await reply(w.documentSetAside(dictionaries[candidateLocale(candidate)].server.websiteUnreadable))
    return
  }
  // Pausing the search, or resuming it: proposed with its own buttons, and
  // only when it would change something.
  if (answer.action?.type === 'pause_search' || answer.action?.type === 'resume_search') {
    const pause = answer.action.type === 'pause_search'
    if (pause !== isSearchPaused(candidate.id)) buttons = proposePause(candidate.id, pause, answer.action.type === 'pause_search' ? answer.action.checkIn : null)
  } else if (answer.action?.type === 'set_name') {
    // A new name, or their language: proposed with its own buttons, and
    // only when it would change something.
    buttons = proposeName(candidate.id, answer.action.name)
  } else if (answer.action?.type === 'set_language') {
    buttons = proposeLanguage(candidate.id, answer.action.language)
  } else if (
    answer.action?.type === 'profile_note' ||
    answer.action?.type === 'profile_correction' ||
    answer.action?.type === 'answers_gap' ||
    answer.action?.type === 'show_offer'
  ) {
    // Their map: after the reply.
  } else if (answer.action) {
    // What it decided to do: prepare an application (offered with buttons),
    // or keep the news they gave about one.
    const done = runAction(candidate.id, answer.action, w.applyButtons)
    if (done.buttons) buttons = done.buttons
  }
  await reply(answer.reply, buttons)
  // Why an offer did not fit, when it holds for others too: asked at once,
  // with its own buttons (#42); on their yes it applies to the ones waiting too.
  const reason = awaited ? answer.reasonItDoesNotFit : null
  if (awaited && reason && !buttons?.length) {
    const opportunityId = getMatch(awaited.matchId)?.opportunity_id
    const rule = opportunityId
      ? await readNo(candidate.id, opportunityId, reason, 'chat').catch((error: unknown) => {
          console.error('[amble] learn from a no failed:', error instanceof Error ? error.message : error)
          return null
        })
      : null
    if (rule && 'excluded' in rule) {
      // The company itself, turned down: done, and said (#44).
      await reply(rule.until ? w.companyExcludedForAYear(rule.company) : w.companyExcluded(rule.company))
    } else if (rule) {
      const label = rule.label ?? rule.statement
      await reply(w.noRuleAsk(label), proposePreference(candidate.id, { kind: rule.kind, label, statement: rule.statement, replaces: null }, w.noRuleButtons))
    }
  }
  // A company they want nothing from, or one let back in (#44): done here,
  // and said, so the agent never says it noted one it did not.
  if (answer.action?.type === 'exclude_company' || answer.action?.type === 'include_company') {
    const done = companyAction(candidate.id, answer.action)
    if (!done) await reply(w.companyNotFound(answer.action.company))
    else if (answer.action.type === 'include_company') await reply(w.companyIncluded(done.company))
    else await reply(done.until ? w.companyExcludedForAYear(done.company) : w.companyExcluded(done.company))
  }
  // The other chat app (#52): its link, sent by amble and not the model, so
  // it is never one made up.
  if (answer.action?.type === 'connect_app') {
    const app = answer.action.app
    const name = app === 'telegram' ? 'Telegram' : 'WhatsApp'
    const done = connectApp(candidate.id, app, w.linkMessage)
    if (done === 'unavailable') await reply(w.connectAppUnavailable(name))
    else if (done === 'connected') await reply(w.connectAppAlready(name))
    else await reply(app === 'telegram' ? w.connectTelegramLink(done.url) : w.connectWhatsAppLink(done.url))
  }
  // The offer they asked to see: its card, with its buttons to answer it.
  if (answer.action?.type === 'show_offer') {
    const opportunityId = offerToShow(candidate.id, answer.action.company, answer.action.title)
    const shown = opportunityId
      ? await showTeasedOffer(candidate.id, opportunityId, true).catch((error: unknown) => {
          console.error('[amble] offer card not sent:', opportunityId, error instanceof Error ? error.message : error)
          return false
        })
      : false
    if (!shown) console.error('[amble] offer to show not found:', answer.action.company, answer.action.title, opportunityId)
    if (!shown) await reply(w.offerNotFound)
  }
  for (const reminder of answer.reminders) leaveReminder(candidate.id, reminder.date, reminder.message)
  // Their answer to the interview question waiting on WhatsApp.
  const question = answer.answersInterview ? pendingInterviewQuestion(candidate.id) : null
  if (question) answerInterviewQuestion(candidate.id, question.turnId, text)
  // What they told about their work, in their own words (what they wrote,
  // not amble's note on it), taken into their map, unless it was that
  // answer. A correction first shows what it would take off the map, with
  // buttons; when nothing there is what they say is wrong, what they said
  // is taken in as told.
  if (!question && answer.action?.type === 'profile_note') takeNote(candidate.id, message)
  // An answer to a question their map shows: only one it shows now; any
  // other id the agent gave is taken as what they told.
  if (!question && answer.action?.type === 'answers_gap') {
    const gapId = answer.action.gap
    const gap = mapGapsOf(candidate.id).some((item) => item.id === gapId) ? getUncertainty(gapId) : undefined
    if (gap && gap.candidate_id === candidate.id && gap.status === 'OPEN') takeGap(candidate.id, gap, message)
    else takeNote(candidate.id, message)
  }
  if (!question && answer.action?.type === 'profile_correction') {
    const proposal = await proposeCorrection(candidate.id, message, answer.action.what).then(
      (found) => found ?? 'none',
      () => null,
    )
    if (proposal === 'none') takeNote(candidate.id, message)
    else if (proposal) await reply(proposal.text, proposal.buttons)
    else await reply(w.agentFailed)
  }
  // Only what the agent marks for the team (a problem, a suggestion, a sign
  // of distress), and not more than a few a day from one person.
  if (answer.forward && feedbackToday(candidate.id, 'whatsapp') < MAX_FORWARDS_A_DAY) {
    const row = recordFeedback(candidate, { message: text, page: null, channel: 'whatsapp' })
    await emailOwnerAbout(candidate, row)
  }
}

// A voice note: fetched from the provider (it needs our key, and WhatsApp
// drops media after a while, so now) and transcribed. The audio is not kept.
async function hear(voice: IncomingFile, language: string): Promise<string> {
  // A voice note, not a file of any size.
  const bytes = await voice.fetch(MAX_AUDIO_BYTES)
  if (!bytes) return ''
  const mimeType = voice.mimeType ?? 'audio/ogg'
  const audio = new Blob([new Uint8Array(bytes)], { type: mimeType })
  return transcribe(audio, mimeType.includes('mp4') ? 'note.m4a' : 'note.ogg', language)
}

// WhatsApp's voice note, as it always was fetched: our key only to Zernio's
// own media endpoint, never to another host.
async function fetchZernioVoice(apiKey: string, url: string, maxBytes: number): Promise<Buffer | null> {
  const own = new URL(url).hostname === 'zernio.com'
  const response = await fetch(url, { headers: own ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) return null
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  return bytes.length > maxBytes ? null : bytes
}

// What one person may ask the agent: enough for any conversation, not for
// a script. Counted from what they wrote, as kept in the conversation.
const PER_HOUR = 20
const PER_DAY = 100
const MAX_FORWARDS_A_DAY = 5

function overLimit(candidateId: string): boolean {
  const count = (since: number) =>
    (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE candidate_id = ? AND direction = 'in' AND created_at >= ?")
        .get(candidateId, new Date(Date.now() - since).toISOString()) as { n: number }
    ).n
  return count(60 * 60 * 1000) >= PER_HOUR || count(24 * 60 * 60 * 1000) >= PER_DAY
}

// A reading kept at a set length can end mid-word: said up to its last
// whole sentence, when it has one.
function wholeSentences(text: string): string {
  if (/[.!?…)»"”]\s*$/.test(text)) return text
  const end = Math.max(text.lastIndexOf('. '), text.lastIndexOf('; '))
  return end > 0 ? `${text.slice(0, end)}.` : `${text}…`
}

// The verdict on an offer they brought, as a message: what it is for them
// and why, or why not; with the buttons when it is worth their time.
function presentVerdict(verdict: SharedVerdict, w: (typeof dictionaries)['es']['whatsapp']): { text: string; buttons?: { title: string; payload: string }[] } {
  const { match, explanation, gates, title, company } = verdict
  const head = `*${title}* · ${company}`
  if (match.verdict === 'discarded') {
    const failed = gates.find((gate) => gate.result === 'fail')
    const why =
      explanation.roleFit.fit === 'wrong_role' || explanation.roleFit.fit === 'below_level' || explanation.roleFit.fit === 'above_level'
        ? explanation.roleFit.reason
        : (failed?.note || failed?.quote || explanation.roleFit.reason)
    return { text: [head, '', w.sharedNo, wholeSentences(why)].filter(Boolean).join('\n') }
  }
  const lines = [
    head,
    '',
    match.verdict === 'show' ? w.sharedFits : w.sharedDoubt,
    explanation.summary,
    ...explanation.why.slice(0, 3).map((reason) => `• ${reason.text}`),
    explanation.considerAlso ? `\n${w.considerAlso}: ${explanation.considerAlso.text}` : null,
  ].filter((line): line is string => line !== null && line !== undefined)
  return {
    text: lines.join('\n'),
    buttons: [
      { title: w.offerButtons.interested, payload: `of:${match.id}:interested` },
      { title: w.offerButtons.notFit, payload: `of:${match.id}:not_fit` },
      { title: w.offerButtons.more, payload: `of:${match.id}:more` },
    ],
  }
}

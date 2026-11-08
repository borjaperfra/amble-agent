import { cloudBrowserConfigured } from '../apply/cloud'
import { theirStackConfigured } from '../sourcing/theirstack'
import { telegramConfig } from '../telegram/api'
import type { AgentAction } from './agent'
import { zernioConfig } from './zernio'

// What amble can do for someone, in one place: what the Rep says it can do
// (the "WHAT YOU CAN DO" part of its prompt) and the app's pages it links to
// (appPages) are made from this list, so a feature added here reaches the
// Rep, and one the Rep says amble has is here. Testers asked the Rep about
// things amble did and heard «no lo sé; lo paso al equipo» (#52, Telegram),
// or were offered things it could not do there (#48, filling a form; #46, a
// new CV): each came from a list written by hand that fell behind.
//
// Each entry says, for the model, what it is (in English, as the prompt is),
// where it is done (the chat apps, the app, or both), which of the agent's
// actions does it, or which page of the app has it, and when it is there at
// all. tests/agent-capabilities.ts checks that every action of the agent has
// an entry and a handler, and that every page exists.

export type Channel = 'whatsapp' | 'telegram' | 'app'
export type AgentActionType = AgentAction['type']

// When something is there only on some deployments: off, the Rep is told it
// is not available now (notAvailableNow) and never offers it.
// (Which chat apps amble has, the Rep also sees per person in chatApps.)
export type Condition = 'whatsapp' | 'telegram' | 'cloud_browser' | 'theirstack'

const CONDITIONS: Record<Condition, () => boolean> = {
  whatsapp: () => zernioConfig() !== null,
  telegram: () => telegramConfig() !== null,
  cloud_browser: cloudBrowserConfigured,
  theirstack: theirStackConfigured,
}

// The app's pages the Rep may send them to, by the name it sees them under.
// Each link it sends opens their own account (signAppLinks).
export const APP_PAGES = {
  offersToAnswer: '/opportunities?tab=new',
  offersTheyFollow: '/opportunities?tab=wanted',
  offersForLater: '/opportunities?tab=later',
  applicationsSent: '/opportunities?tab=sent',
  offersSetAside: '/opportunities?tab=aside',
  whatAmbleListensFor: '/listening',
  yourRules: '/me/preferences',
  sayWhatYouWant: '/me/intent',
  sampleOffers: '/me/triage',
  yourMap: '/me',
  yourCv: '/me/cv',
  questionsAboutYou: '/onboarding/interview',
  addDocument: '/onboarding',
  yourData: '/me/data',
} as const

export type AppPage = keyof typeof APP_PAGES

export interface Capability {
  id: string
  // For the model: one line of its prompt, in its words.
  does: string
  channels: readonly Channel[]
  // The agent's actions that do it, when it is one of them.
  actions?: readonly AgentActionType[]
  // The app's page that has it, when it is done there.
  page?: AppPage
  // Only when this holds; named for the Rep (notAvailableNow) when it does not.
  when?: { condition: Condition; name: string }
}

const CHAT = ['whatsapp', 'telegram'] as const
const EVERYWHERE = ['whatsapp', 'telegram', 'app'] as const

// In the chat: what the Rep does itself, in the order its prompt says them.
export const CHAT_CAPABILITIES: readonly Capability[] = [
  {
    id: 'answer',
    does: 'Answer from what you know about them (below).',
    channels: CHAT,
  },
  {
    id: 'prepare_application',
    does: 'Prepare an application for an offer they follow: the form\'s answers and advice, which they review and send themselves on the offer\'s own page. You never send an application on your own, and never on words alone.',
    channels: EVERYWHERE,
    actions: ['prepare_application'],
    page: 'offersTheyFollow',
  },
  {
    id: 'fill_form',
    does: 'Fill in the company\'s own form, only for some offers (amble can fill some application forms, not all): once an application is prepared, amble offers it with a button where it can, and sends it when they tap "Send it" under the picture of the filled form; only that tap sends one. Never promise it for a given offer, and never say amble cannot apply for them at all.',
    channels: EVERYWHERE,
    actions: ['prepare_application'],
    when: { condition: 'cloud_browser', name: 'filling in the company\'s form for them' },
  },
  {
    id: 'application_update',
    does: 'Note how an application is going when they tell you (they applied, got a call or an interview, were turned down, got an offer).',
    channels: CHAT,
    actions: ['application_update'],
  },
  {
    id: 'judge_posting',
    does: 'Judge an offer they paste in: when their message is the text of a job posting, set "action" to {"type": "evaluate_posting", "company", "title"} with the company and title as the text gives them, and say in a line that you are reading it. If their message says a link they sent could not be read, ask them to paste the offer\'s text. If it says amble did not open it because it is known to spread malware, tell them so plainly and not to open it, then ask for the offer\'s text.',
    channels: CHAT,
    actions: ['evaluate_posting'],
  },
  {
    id: 'read_link',
    does: 'Tell what a link they sent is. A link that does not mark itself as a job offer reaches you with a note from amble and the page\'s title and first lines between markers. A job posting: {"type": "evaluate_posting", "company", "title"} as the page gives them, and a line that you are reading it. Their own work or a page about them (their portfolio or website, a project or repository of theirs, something they wrote or presented, a profile of theirs), shared so it counts on their map: set "action" to {"type": "read_link"}, and your reply is one short line that you will read it for their map; amble reads it as it reads a document they send, and tells them what it added. Whose it is comes from their message or the page itself; when you cannot tell it is theirs, ask, and set no action. Anything else (news, a company\'s own page, someone else\'s article): no action; answer what they asked about it from what the note gives you, never as if you had judged an offer.',
    channels: CHAT,
    actions: ['evaluate_posting', 'read_link'],
  },
  {
    id: 'reminders',
    does: 'Leave yourself messages to send them on later days, in "reminders" (at most two): for an interview they mention, one the day before with two or three concrete points to prepare for that role, drawn from the offer and the parts of their map that matter for it (never an open interview question or anything unrelated to that job), and one the day after asking how it went; for a deadline they give you, one the day before. Each is {"date": "YYYY-MM-DD", "message": the WhatsApp message to send that day, short and specific, in their language}. Only for a real date they gave you (work it out from TODAY); none that is already in remindersAhead; nothing else (not a start date, a check-in or a nudge).',
    channels: CHAT,
  },
  {
    id: 'interview_question',
    does: 'Ask them the interview questions that are still open: one may be waiting (pendingInterviewQuestion). When their message answers it, set "answersInterview": true and thank them in a line; otherwise false, and the question keeps waiting: it is already in the chat, so do not repeat it or remind them of it unless they ask.',
    channels: CHAT,
  },
  {
    id: 'why_it_does_not_fit',
    does: 'Keep why an offer does not fit them: when waitingForWhyItDoesNotFit is set, they just marked that offer as not fitting and were asked why. If their message gives the reason, even in a few words ("too junior", "no Barcelona"), set "reasonItDoesNotFit" to it in their words and thank them in a line, without a new question. If their message is about something else, leave it null and answer what they wrote.',
    channels: CHAT,
  },
  {
    id: 'propose_rule',
    does: 'Propose a change to what you listen for; it applies only when they confirm.',
    channels: EVERYWHERE,
    page: 'yourRules',
  },
  {
    id: 'exclude_company',
    does: 'Stop showing them a company, when they ask (#44): when they say they want nothing (more) from a company ("no me enseñes más de Canonical", "de Affirm no me mandes nada", "ya me rechazaron en X y no puedo volver a aplicar"), set "action" to {"type": "exclude_company", "company": its name, "forAYear": true when it turned them down or will not let them apply again for a while, else false}; your reply is one short line taking it in, never that it is done: amble says so right after. To let one back in, {"type": "include_company", "company"}. The companies already excluded are companiesExcluded. Never say you noted, will avoid or will stop sending a company without this action.',
    channels: CHAT,
    actions: ['exclude_company', 'include_company'],
  },
  {
    id: 'pause_search',
    does: 'Pause the search until further notice, or resume it, when they ask; it applies only when they confirm. While it is paused (searchPaused), amble reads nothing for them and writes nothing first; you still answer when they write.',
    channels: EVERYWHERE,
    actions: ['pause_search', 'resume_search'],
  },
  {
    id: 'answers_gap',
    does: 'Take an answer to what their map shows as still unknown: mapGaps are the questions the "still unknown" part of their map shows them, each with its id, which they may answer here without being asked. When their message answers one of them (it says what that question asks, even briefly), set "action" to {"type": "answers_gap", "gap": its id} and say in a line that you are adding it to their map; amble takes it in as the answer to that question and tells them what it changed. This comes before "profile_note" when both fit, and never when it answers pendingInterviewQuestion ("answersInterview" then).',
    channels: CHAT,
    actions: ['answers_gap'],
  },
  {
    id: 'profile_note',
    does: 'Keep their map up to date from what they tell you (their map is the professional profile amble built from what they shared, which every offer is judged against). When their message adds something about their own work or experience that is not in what you know (a project, a responsibility, a result, a skill, how long), set "action" to {"type": "profile_note"} and say in a line that you are adding it to their map, never that it is already there: amble takes it from their own words, as it takes an answer to an interview question, and then tells them what it added. When their message says something in their map is wrong (not true, not theirs, the team\'s or someone else\'s work, a wrong number, title or date: "eso lo hizo el equipo, no yo", "son 6 años, no 4"), set "action" to {"type": "profile_correction", "what": what they say is wrong, and the right version if they give it, in a sentence close to their words} and say in one short line that you are looking for it in their map, and nothing more ("Vale, lo busco en tu mapa."): what would come off it follows on its own, with buttons to confirm, so do not describe it or the buttons. Only for what they say themselves about their own work: never for what you suggest or infer, a question about what their map says, or advice on how to present something. When their message answers pendingInterviewQuestion, that is "answersInterview", not this.',
    channels: CHAT,
    actions: ['profile_note', 'profile_correction'],
  },
  {
    id: 'name_and_language',
    does: 'Change the name you call them by, or the language you talk to them in (Spanish or English, here and in the app), when they ask: set "action" to {"type": "set_name", "name": the name as they wrote it} or {"type": "set_language", "language": "es"|"en"}, and ask it as a question in a line ("¿Te llamo Bea a partir de ahora?"); they get buttons to confirm, so never say it is done. If it is already so (name, language), say so in a line and set no action.',
    channels: CHAT,
    actions: ['set_name', 'set_language'],
  },
  {
    id: 'connect_app',
    does: 'Connect them on the other chat app (#52): amble talks to people on WhatsApp and on Telegram, and someone may have both, writing to them where they last wrote. When they ask to talk to you on the other one ("¿puedo hablar contigo por Telegram?", "connect my WhatsApp"), set "action" to {"type": "connect_app", "app": "telegram"|"whatsapp"} and your reply is one short line that you are sending them the link; amble sends it right after, or says why it cannot (chatApps says which apps amble has and which they connected). Never say amble is not on an app that chatApps lists as available.',
    channels: EVERYWHERE,
    actions: ['connect_app'],
    page: 'yourMap',
  },
  {
    id: 'read_document',
    does: 'Read a new CV, or their LinkedIn profile as a PDF: they send the file here, in this chat, and amble reads it into their map and tells them what it added; a newer CV takes the old one\'s place. In the app they can do the same (addDocument: "Upload a new one", "Subir uno nuevo" in Spanish, beside the CV already read). If they ask how to update their CV or their map with a document, tell them that.',
    channels: EVERYWHERE,
    page: 'addDocument',
  },
  {
    id: 'voice_notes',
    does: 'Hear a voice note: amble turns it into text, and what they said reaches you as their message.',
    channels: CHAT,
  },
  {
    id: 'daily_offers',
    does: 'Send them the offers that fit, once a day, as a short numbered list (up to four, a line each) they pick from, tapping a number or writing it back ("2", "1 y 3", "todas"); a single offer comes in full at once. The ones on it are among the offers you sent them. Numbers they write back to it are handled by amble before you see them; when they name one of the list in words ("la de Pigment"), that is "show_offer". An offer in full comes with buttons to answer it (interested, not a fit, and on WhatsApp "tell me more").',
    channels: CHAT,
    actions: ['show_offer'],
  },
  {
    id: 'what_amble_writes_first',
    does: 'Write first, at most once a day and never at night, only when there is something for them, the most important first: a reminder they asked for; a follow-up a week after they sent an application, saying the day they sent it, and when they say they were called, a button to prepare that interview with you; on Mondays, when something moved, a summary of their week (what they sent, who called or said no, what interested them, and one they liked and have not sent); the day\'s offers; after four days with no offer for them, why, and a question that could widen the search; a rule proposed from an offer they turned down in the app, asked once; an offer they liked and have not sent after three days, asked once; a question for their map; once, on a day with nothing else, that their CV was compared with their offers (yourCv). When they ask why amble wrote, say which of these it was.',
    channels: CHAT,
  },
  {
    id: 'where_offers_come_from',
    does: 'Say where amble reads offers (#51): on the job pages of the many companies it watches, and a part of the offers on LinkedIn and Indeed; not everything they see on LinkedIn reaches amble. whatAmbleListensFor says it too.',
    channels: EVERYWHERE,
    page: 'whatAmbleListensFor',
    when: { condition: 'theirstack', name: 'reading offers from LinkedIn and Indeed (amble reads only the job pages of the companies it watches; LinkedIn\'s offers do not reach it)' },
  },
  {
    id: 'offer_closed',
    does: 'Take an offer off their list when they say it is closed, and show again one amble gave them when they ask to see it (see "offer" below).',
    channels: CHAT,
    actions: ['offer_closed', 'show_offer'],
  },
  {
    id: 'coach',
    does: 'Coach them on their career and search.',
    channels: CHAT,
  },
]

// In the app only: the Rep cannot do these from the chat; it sends them to
// the page, with its link.
export const APP_CAPABILITIES: readonly Capability[] = [
  {
    id: 'answer_offers',
    does: 'Answer the offers waiting for them, each with why it was shown: interested, not for me, or "For later" ("Para más adelante" in Spanish).',
    channels: ['app'],
    page: 'offersToAnswer',
  },
  {
    id: 'later',
    does: 'Keep an offer for later (#25): neither a yes nor a no; nothing is learned from it and it is never sent again. It waits in its own tab, where they can still want it, turn it down or mark it as sent. You cannot mark one for later from here.',
    channels: ['app'],
    page: 'offersForLater',
  },
  {
    id: 'follow_applications',
    does: 'See the offers they follow and the applications they prepared (offersTheyFollow), and the ones they sent (applicationsSent), where they can mark one as sent too.',
    channels: ['app'],
    page: 'offersTheyFollow',
  },
  {
    id: 'set_aside',
    does: 'See the offers amble set aside and why, and take one anyway with its button ("Esta sí me interesa" in Spanish).',
    channels: ['app'],
    page: 'offersSetAside',
  },
  {
    id: 'rules',
    does: 'See and change every rule amble applies, one by one (what it never shows them, the pay, what weighs, what it does not rule out for), and confirm the ones waiting for review.',
    channels: ['app'],
    page: 'yourRules',
  },
  {
    id: 'about_you',
    does: 'Say where they live, the languages they can work in and their level in each (an offer asking for a level above theirs is set aside), and whether they also want offers from the US (#16: otherwise someone in Europe gets offers open to Europe): under "About you" ("Sobre ti") on yourRules. You cannot change these from here.',
    channels: ['app'],
    page: 'yourRules',
  },
  {
    id: 'say_what_you_want',
    does: 'Tell amble in their own words what they are looking for (sayWhatYouWant), or answer a few sample offers so it learns what they want (sampleOffers).',
    channels: ['app'],
    page: 'sayWhatYouWant',
  },
  {
    id: 'listening',
    does: 'See what amble listens for, what it read for them this week, and where it reads offers.',
    channels: ['app'],
    page: 'whatAmbleListensFor',
  },
  {
    id: 'map',
    does: 'See their map, and add proof of one of its capabilities under its evidence, in words or with a link, without waiting for a question.',
    channels: ['app'],
    page: 'yourMap',
  },
  {
    id: 'cv_review',
    does: 'See what to change in their CV (#55, "Tu CV, mejor" in Spanish): amble reads it next to the offers that fit them and their map, and lists what they have done that their CV does not say (with a line to copy, from their own proof), what it says without a result, what several offers ask for that amble has not seen in them, and what a filter program would miss (no dates, generic words, two columns, missing contact). No score. It is ready once amble has read at least ten offers that fit them. When they ask for help with their CV, send them there; you cannot rewrite their whole CV or make a file of it.',
    channels: ['app'],
    page: 'yourCv',
  },
  {
    id: 'questions',
    does: 'Answer the questions amble still has about them, written or by voice.',
    channels: ['app'],
    page: 'questionsAboutYou',
  },
  {
    id: 'data',
    does: 'Download everything amble has about them, or delete their account at once.',
    channels: ['app'],
    page: 'yourData',
  },
]

export const CAPABILITIES: readonly Capability[] = [...CHAT_CAPABILITIES, ...APP_CAPABILITIES]

// Every action the agent has, with the capabilities it serves: a new action
// with no entry here does not compile, and tests/agent-capabilities.ts checks
// that each has an entry above.
export const ACTION_CAPABILITY: Record<AgentActionType, string> = {
  prepare_application: 'prepare_application',
  application_update: 'application_update',
  offer_closed: 'offer_closed',
  show_offer: 'offer_closed',
  evaluate_posting: 'judge_posting',
  pause_search: 'pause_search',
  resume_search: 'pause_search',
  profile_note: 'profile_note',
  profile_correction: 'profile_note',
  read_link: 'read_link',
  answers_gap: 'answers_gap',
  set_name: 'name_and_language',
  set_language: 'name_and_language',
  exclude_company: 'exclude_company',
  include_company: 'exclude_company',
  connect_app: 'connect_app',
}

// What the Rep must not offer where amble runs now, named for it.
export function notAvailableNow(): string[] {
  return CAPABILITIES.flatMap((capability) => (capability.when && !CONDITIONS[capability.when.condition]() ? [capability.when.name] : []))
}

// The app's pages, as links.
export function appPagesAt(base: string): Record<AppPage, string> {
  return Object.fromEntries(Object.entries(APP_PAGES).map(([name, route]) => [name, `${base}${route}`])) as Record<AppPage, string>
}

// What the Rep can't do, after what it can: the same words its prompt had.
const LIMITS = `You cannot browse the web, look up a company, or see anything outside what is below. When they ask for more offers, those waiting for them in the app (inTheAppToAnswerList) can be shown here, one at a time, with "show_offer": say how many wait and show the first; you cannot make amble find more or send its list sooner, and you cannot close or remove an offer, read a picture, remove a document they shared, change their email, delete their account, or change anything else about their account: for those, say where in the app they can do it (their data, downloading it and deleting their account: yourData; their map: yourMap), or pass it to the team ("forward"). Whatever notAvailableNow names is off for now: never offer it, and if they ask, say it is not available yet. When they ask whether amble can do something, the answer is in these lists: say it, never that you do not know or that you will ask the team. Never offer or promise to do anything that is not in these lists.`

// The "WHAT YOU CAN DO" part of the Rep's prompt.
export function capabilitiesPrompt(): string {
  return [
    'WHAT YOU CAN DO, and nothing else:',
    ...CHAT_CAPABILITIES.map((capability) => `- ${capability.does}`),
    'IN THE APP, where you send them with the page\'s link from appPages (you cannot do these from here):',
    ...APP_CAPABILITIES.map((capability) => `- ${capability.page}: ${capability.does}`),
    LIMITS,
  ].join('\n')
}

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import UserZeroInterruption from '@/components/userzero/UserZeroInterruption'
import UserZeroQuestion, { type OpenQuestion } from '@/components/userzero/UserZeroQuestion'
import styles from '@/app/listening/listening.module.css'
import type { InterruptionView } from '@/lib/opportunity-view'
import type { CandidateResponse } from '@/domains/opportunity/types'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@/lib/copy'
import TellYourRep from './TellYourRep'
import Exceptions from './Exceptions'
import OpenThreads, { type OpenThread } from './OpenThreads'
import type { Exception } from '@/lib/pipeline/exceptions'

interface ListeningVm {
  evidenceCount: number
  capabilitiesCount: number
  listeningFor: string[]
  hasIntent: boolean
  intentConfirmed: boolean
  criteria: string[]
  notifyChannels: string[]
  notifyEmail: string | null
  notifyWhatsapp: string | null
  notifyTelegram: string | null
  language: Language
}

type Phase = 'arriving' | 'home'
type Channel = 'email' | 'telegram' | 'whatsapp'

const activationMs = 2600

/**
 * How often the screen asks whether anything got through.
 *
 * The reading runs on the queue, so nothing can arrive as the answer to a
 * request: the screen finds out afterwards, the same way it would find out
 * from a message. Slow on purpose — this is a screen someone leaves open.
 */
const interruptionPollMs = 6000

/**
 * Las palabras de esta pantalla.
 *
 * Aquí y no en `lib/copy` porque aquello es lo que sale por el mensaje: si
 * se mezclan, cambiar un botón obliga a leer los dos.
 */
const WORDS = {
  es: {
    arriving: 'Tu Rep está escuchando.',
    thanks: 'Gracias. Apuntado.',
    thanksNote:
      'Lo estoy metiendo en lo que sé de ti. Si cambia lo que pienso de ese puesto, te aviso; si no, no.',
    heardThemOut: 'Hecho, lo he apuntado.',
    heardThemOutNote:
      'No les he dicho nada. Todavía no puedo hablar con una empresa por ti; cuando pueda, empieza aquí.',
    notForMe: 'Vale, fuera.',
    notForMeNote:
      'No he cambiado lo que escucho. Un no es sobre ese puesto, no sobre lo que buscas.',
    nothingWorth: 'Nada que merezca molestarte.',
    stillListening: 'Sigo escuchando.',
    onlyInterrupt: 'Solo te interrumpo cuando algo merece tu atención.',
    listeningForLabel: 'Ahora mismo escucho',
    confirmIntent: 'Confirma qué tiene que escuchar tu Rep.',
    noIntent: 'Todavía no le has dicho a tu Rep qué escuchar.',
    changeIntent: 'Cambiar lo que escucho',
    fromHere: 'A partir de aquí',
    dealLead:
      'Ya están entrando ofertas — de momento leo el tablón de Manfred. Casi ninguna llegará hasta ti. Ese es el trato.',
    deal1:
      'La comparo con lo que me dejaste dicho. Si no lo cumple, no te enteras: ni resumen ni "quizá también te interese".',
    deal2:
      'Si lo cumple, recibes un mensaje: qué es el puesto, qué paga y qué tienes tú que me hizo pensar que merecía tu rato.',
    deal3: 'Tu Mapa se queda aquí. Nadie lo ve y no sale nada hasta que tú lo digas.',
    reachAria: 'Cómo localizarte',
    reachKicker: 'Cuando pase',
    reachLead: '¿Dónde te aviso?',
    emailPlaceholder: 'tu@correo.com',
    emailAria: 'Correo',
    telegramPlaceholder: 'Tu chat id',
    telegramAria: 'Chat id de Telegram',
    telegramHint: 'Escríbele al bot una vez y ejecuta ',
    telegramHintEnd:
      '; te dirá el número. A partir de ahí puedes contestarme respondiendo ahí mismo, sin volver a esta pantalla.',
    whatsappPlaceholder: '+34 600 000 000',
    whatsappAria: 'Número de WhatsApp',
    languageKicker: 'Idioma',
    languageAria: 'En qué idioma te hablo',
    languageNote: 'Vale para los mensajes, esta pantalla y lo que escribe el modelo.',
    saved: 'Guardado.',
    notSaved: 'No se ha guardado. Prueba otra vez.',
    offline: 'Ahora mismo no hay conexión. Habrá que guardarlo otra vez.',
    pickOne: 'Elige uno y me lo quedo.',
    repLabel: 'Tu Rep',
    evidence: (count: number) => `${count} evidencias`,
    capabilities: (count: number) => `${count} capacidades`,
    mapLink: 'Ver tu Mapa Profesional →',
    viewListening: 'Ver estado de escucha',
    viewReturn: 'Ver estado de vuelta',
    channels: { email: 'Correo', telegram: 'Telegram', whatsapp: 'WhatsApp' },
    telegramNote: 'aquí sí se contesta',
    whatsappNote: 'todavía no funciona',
  },
  en: {
    arriving: 'Your Rep is listening.',
    thanks: 'Thank you. Noted.',
    thanksNote:
      "I'm working it into what I know about you. If it changes what I think of that role, you'll hear from me; if it doesn't, you won't.",
    heardThemOut: "Good. I've written that down.",
    heardThemOutNote:
      "Nothing has gone to them. I can't talk to a company on your behalf yet — when I can, this is where it starts.",
    notForMe: "Fine. That one's gone.",
    notForMeNote:
      "I haven't changed what I'm listening for. A no is about that job, not about the shape of what you want.",
    nothingWorth: 'Nothing worth bothering you with.',
    stillListening: "I'm still listening.",
    onlyInterrupt: "I'll only interrupt you when something deserves your attention.",
    listeningForLabel: 'Currently listening for',
    confirmIntent: 'Confirm what your Rep should listen for.',
    noIntent: "You haven't told your Rep what to listen for yet.",
    changeIntent: "Change what I'm listening for",
    fromHere: 'From here',
    dealLead:
      "Offers have started arriving — I'm reading Manfred's board for now. Almost none of them will reach you. That is the deal.",
    deal1:
      'I hold it against what you left me with. If it does not clear that, you never hear about it — no digest, no "you might also like".',
    deal2:
      'If it does clear it, you get one message: what the role is, what it pays, and the specific thing about you that made me think it was worth your time.',
    deal3: 'Your Map stays here. Nobody sees it, and nothing is sent anywhere, until you say so.',
    reachAria: 'How to reach you',
    reachKicker: 'When it happens',
    reachLead: 'Where should I reach you?',
    emailPlaceholder: 'you@example.com',
    emailAria: 'Email address',
    telegramPlaceholder: 'Your chat id',
    telegramAria: 'Telegram chat id',
    telegramHint: 'Message the bot once and run ',
    telegramHintEnd:
      '; it will tell you the number. After that you can answer me by replying there — you will not have to come back to this screen.',
    whatsappPlaceholder: '+34 600 000 000',
    whatsappAria: 'WhatsApp number',
    languageKicker: 'Language',
    languageAria: 'Which language I speak to you in',
    languageNote: 'Applies to the messages, this screen, and what the model writes.',
    saved: 'Saved.',
    notSaved: "That didn't save. Try again.",
    offline: 'No connection right now. It will need saving again.',
    pickOne: 'Pick one and I will remember it.',
    repLabel: 'Your Rep',
    evidence: (count: number) => `${count} pieces of evidence`,
    capabilities: (count: number) => `${count} capabilities`,
    mapLink: 'View your Professional Map →',
    viewListening: 'View listening state',
    viewReturn: 'View return state',
    channels: { email: 'Email', telegram: 'Telegram', whatsapp: 'WhatsApp' },
    telegramNote: 'answers work here',
    whatsappNote: 'not working yet',
  },
} as const

const LANGUAGE_NAMES: Record<Language, string> = { es: 'Castellano', en: 'English' }

/**
 * Pick as many as you like. It used to be one, with "Both" as the third
 * option, which worked while there were two of them.
 */
const CHANNELS: Channel[] = [
  'email',
  // The only one that comes back: an answer typed there lands here.
  'telegram',
  // Said out loud rather than quietly accepted: WhatsApp will not let me
  // start a conversation without a template approved in advance, so there is
  // nothing behind this one yet.
  'whatsapp',
]

export default function UserZeroListeningFlow({
  vm,
  interruption: initialInterruption,
  question: initialQuestion,
  exceptions = [],
  threads = [],
}: {
  vm: ListeningVm
  interruption: InterruptionView | null
  question: OpenQuestion | null
  /** Lo que se ha atascado. Vacío casi siempre, y entonces no se ve nada. */
  exceptions?: Exception[]
  /** Lo que sigue en pie entre los dos: consejos y compromisos abiertos. */
  threads?: OpenThread[]
}) {
  // Something is already waiting, so there is nothing to arrive at: skip
  // straight to it. Sitting through "your Rep is listening" when your Rep
  // has already found something is the wrong screen, and it is also the one
  // someone opening a notification would land on.
  const [phase, setPhase] = useState<Phase>(
    initialInterruption || initialQuestion ? 'home' : 'arriving',
  )
  const [interruption, setInterruption] = useState(initialInterruption)
  const [question, setQuestion] = useState(initialQuestion)
  const [thanked, setThanked] = useState(false)
  const [answered, setAnswered] = useState<CandidateResponse | null>(null)
  const [returnState, setReturnState] = useState(false)
  const [channels, setChannels] = useState<Channel[]>(vm.notifyChannels as Channel[])
  const [email, setEmail] = useState(vm.notifyEmail ?? '')
  const [whatsapp, setWhatsapp] = useState(vm.notifyWhatsapp ?? '')
  const [telegram, setTelegram] = useState(vm.notifyTelegram ?? '')
  const [language, setLanguage] = useState<Language>(vm.language)
  const [saved, setSaved] = useState<string | null>(null)

  const words = WORDS[language] ?? WORDS[DEFAULT_LANGUAGE]

  async function saveReach(
    next: Partial<{
      channels: Channel[]
      email: string
      whatsapp: string
      telegram: string
      language: Language
    }>,
  ) {
    const body = {
      notifyChannels: next.channels ?? channels,
      notifyEmail: next.email !== undefined ? next.email : email,
      notifyWhatsapp: next.whatsapp !== undefined ? next.whatsapp : whatsapp,
      notifyTelegram: next.telegram !== undefined ? next.telegram : telegram,
      language: next.language ?? language,
    }
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setSaved(response.ok ? words.saved : words.notSaved)
    } catch {
      setSaved(words.offline)
    }
  }

  useEffect(() => {
    let activated = false
    try {
      activated = window.sessionStorage.getItem('amble-listening-activated') === '1'
      window.sessionStorage.removeItem('amble-listening-activated')
    } catch {
      activated = false
    }
    const delay = activated ? activationMs : 0
    const id = window.setTimeout(() => setPhase('home'), delay)
    return () => window.clearTimeout(id)
  }, [])

  // Nothing can arrive as the answer to a request — the reading happens on
  // the queue — so the screen asks every so often and goes on saying
  // nothing until there is something to say.
  useEffect(() => {
    if (phase !== 'home' || interruption) return
    const check = async () => {
      try {
        const response = await fetch('/api/opportunities/interruption')
        if (!response.ok) return
        const body = (await response.json()) as {
          interruption: InterruptionView | null
          question: OpenQuestion | null
        }
        if (body.interruption) {
          setInterruption(body.interruption)
          setAnswered(null)
        }
        // A question can arrive at any point, and can also disappear: an
        // answer already given takes a minute to work through the graph,
        // and it must not come back while it does.
        setQuestion(body.question)
        if (body.question) setThanked(false)
      } catch {
        // Out of signal. Whatever it is will still be there next tick.
      }
    }
    const id = window.setInterval(() => void check(), interruptionPollMs)
    return () => window.clearInterval(id)
  }, [phase, interruption])

  if (phase === 'arriving') {
    return (
      <>
        <Header />
        <main className={styles.page}>
          <div className={`${styles.center} ${styles.centerFull}`} role="status">
            <StatusDot />
            <p className={styles.arrivingLine}>{words.arriving}</p>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        {interruption ? (
          <UserZeroInterruption
            interruption={interruption}
            language={language}
            onAnswered={(response) => {
              setInterruption(null)
              setAnswered(response)
            }}
          />
        ) : question ? (
          <UserZeroQuestion
            question={question}
            language={language}
            onAnswered={() => {
              setQuestion(null)
              setThanked(true)
            }}
          />
        ) : thanked ? (
          <div className={`${styles.center} ${styles.centerFull}`}>
            <StatusDot label="Listening" />
            <p className={`${styles.statusLine} ${styles.statusLineReturn}`}>{words.thanks}</p>
            <p className={styles.answeredNote}>{words.thanksNote}</p>
          </div>
        ) : answered ? (
          <div className={`${styles.center} ${styles.centerFull}`}>
            <StatusDot label="Listening" />
            <p className={`${styles.statusLine} ${styles.statusLineReturn}`}>
              {answered === 'HEAR_THEM_OUT' ? words.heardThemOut : words.notForMe}
            </p>
            <p className={styles.answeredNote}>
              {answered === 'HEAR_THEM_OUT' ? words.heardThemOutNote : words.notForMeNote}
            </p>
            <p className={styles.arrivingLine}>{words.stillListening}</p>
          </div>
        ) : returnState ? (
          <div className={`${styles.center} ${styles.centerFull}`}>
            <StatusDot label="Listening" />
            <p className={`${styles.statusLine} ${styles.statusLineReturn}`}>
              {words.nothingWorth}
            </p>
            <p className={styles.arrivingLine}>{words.stillListening}</p>
          </div>
        ) : (
          <div className={styles.center}>
            <StatusDot label="Listening" />
            <p className={styles.statusLine}>{words.onlyInterrupt}</p>
            <div className={styles.listeningFor}>
              <p className="kicker">{words.listeningForLabel}</p>
              {vm.listeningFor.length > 0 ? (
                <div className={styles.listeningForValues}>
                  {vm.listeningFor.map((item) => (
                    <span key={item} className={styles.listeningForValue}>
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.listeningForValue}>
                  {vm.hasIntent ? words.confirmIntent : words.noIntent}
                </p>
              )}
              <div className={styles.changeIntent}>
                <Link href="/me/intent" className="text-btn">
                  {words.changeIntent}
                </Link>
              </div>
            </div>
          </div>
        )}

        {!returnState && !interruption && !answered && !question && !thanked && (
          <>
            <section className={styles.deal} aria-label="What happens from here">
              <p className="kicker">{words.fromHere}</p>
              <p className={styles.dealLead}>{words.dealLead}</p>
              <ul className={styles.dealList}>
                <li className={styles.dealItem}>{words.deal1}</li>
                <li className={styles.dealItem}>{words.deal2}</li>
                <li className={styles.dealItem}>{words.deal3}</li>
              </ul>
              {vm.criteria.length > 0 && (
                <>
                  <div className={styles.criteria}>
                    {vm.criteria.map((criterion) => (
                      <span key={criterion} className={styles.criterion}>
                        {criterion}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className={styles.reach} aria-label={words.reachAria}>
              <p className="kicker">{words.reachKicker}</p>
              <p className={styles.dealLead}>{words.reachLead}</p>
              <div className={styles.reachChips}>
                {CHANNELS.map((channel) => {
                  const on = channels.includes(channel)
                  const note =
                    channel === 'telegram'
                      ? words.telegramNote
                      : channel === 'whatsapp'
                        ? words.whatsappNote
                        : null
                  return (
                    <button
                      key={channel}
                      type="button"
                      className={`${styles.reachChip} ${on ? styles.reachChipOn : ''}`}
                      aria-pressed={on}
                      onClick={() => {
                        const next = on
                          ? channels.filter((value) => value !== channel)
                          : [...channels, channel]
                        setChannels(next)
                        setSaved(null)
                        void saveReach({ channels: next })
                      }}
                    >
                      {words.channels[channel]}
                      {note ? <span className={styles.chipNote}> · {note}</span> : null}
                    </button>
                  )
                })}
              </div>

              {channels.includes('email') && (
                <div className={styles.reachFields}>
                  <input
                    type="email"
                    className={styles.reachInput}
                    placeholder={words.emailPlaceholder}
                    aria-label={words.emailAria}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      setSaved(null)
                    }}
                    onBlur={() => void saveReach({})}
                  />
                </div>
              )}

              {channels.includes('telegram') && (
                <div className={styles.reachFields}>
                  <input
                    type="text"
                    className={styles.reachInput}
                    placeholder={words.telegramPlaceholder}
                    aria-label={words.telegramAria}
                    value={telegram}
                    onChange={(event) => {
                      setTelegram(event.target.value)
                      setSaved(null)
                    }}
                    onBlur={() => void saveReach({})}
                  />
                  <p className={styles.reachHint}>
                    {words.telegramHint}
                    <code>npm run telegram:whoami</code>
                    {words.telegramHintEnd}
                  </p>
                </div>
              )}

              {channels.includes('whatsapp') && (
                <div className={styles.reachFields}>
                  <input
                    type="tel"
                    className={styles.reachInput}
                    placeholder={words.whatsappPlaceholder}
                    aria-label={words.whatsappAria}
                    value={whatsapp}
                    onChange={(event) => {
                      setWhatsapp(event.target.value)
                      setSaved(null)
                    }}
                    onBlur={() => void saveReach({})}
                  />
                </div>
              )}

              <div className={styles.reachFields}>
                <p className="kicker">{words.languageKicker}</p>
                <div className={styles.reachChips} aria-label={words.languageAria}>
                  {LANGUAGES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`${styles.reachChip} ${
                        language === option ? styles.reachChipOn : ''
                      }`}
                      aria-pressed={language === option}
                      onClick={() => {
                        setLanguage(option)
                        setSaved(null)
                        void saveReach({ language: option })
                      }}
                    >
                      {LANGUAGE_NAMES[option]}
                    </button>
                  ))}
                </div>
                <p className={styles.reachHint}>{words.languageNote}</p>
              </div>

              <p className={styles.reachStatus} role="status">
                {saved ?? (channels.length === 0 ? words.pickOne : '')}
              </p>
            </section>
          </>
        )}

        {/* Antes de la caja, porque si algo se atascó eso cambia lo que hay
            que contarle. Vacío casi siempre: su mejor día es el que no sale. */}
        <Exceptions exceptions={exceptions} language={language} />

        {/* Debajo de todo lo que pasa y justo encima de lo que el Rep sabe de
            él: es el orden en el que se lee la pantalla, y quien acaba de
            mirar su perfil es quien se da cuenta de que falta algo. */}
        <TellYourRep language={language} />

        {/* Después de la caja, no antes: lo que cierra un hilo es contarle
            algo que lo cubra, así que primero está dónde contarlo. */}
        <OpenThreads threads={threads} language={language} />

        <div className={styles.repSummary}>
          <p className={styles.repLabel}>{words.repLabel}</p>
          <p className={styles.repCount}>{words.evidence(vm.evidenceCount)}</p>
          <p className={styles.repCount}>{words.capabilities(vm.capabilitiesCount)}</p>
          <Link href="/me" className={`text-btn ${styles.repLink}`}>
            {words.mapLink}
          </Link>
        </div>

        {!interruption && !answered && !question && !thanked && (
          <div className={styles.fixtureToggle}>
            <button
              type="button"
              className={`text-btn ${styles.fixtureToggleBtn}`}
              onClick={() => setReturnState((value) => !value)}
            >
              {returnState ? words.viewListening : words.viewReturn}
            </button>
          </div>
        )}
      </main>
    </>
  )
}

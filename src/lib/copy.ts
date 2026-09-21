/**
 * Todo lo que el Rep dice, en los dos idiomas.
 *
 * Estaba incrustado en el sitio donde se enviaba, que es lo normal hasta que
 * hay dos idiomas: entonces cada frase está en un fichero distinto y cambiar
 * el tono significa buscarlas todas. Aquí están juntas, y quien las manda
 * solo elige idioma.
 *
 * Dos reglas que no son de traducción:
 *
 * - **El porqué es el mismo en los dos.** Se traduce cómo se dice, no lo que
 *   se decide. La evidencia y los huecos salen del grafo y llegan aquí ya
 *   escritos; esto solo pone los títulos y el sobre.
 * - **Corto.** No es una carta comercial: es alguien que lleva un rato
 *   trabajando por ti y te cuenta lo justo. Si una frase no dice nada que no
 *   dijera la anterior, fuera.
 */

export const LANGUAGES = ['es', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'es'

export function asLanguage(value: unknown): Language | null {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : null
}

export interface RepCopy {
  /** El asunto del correo, y lo primero que se ve en una notificación. */
  interruptionSubject: (role: string, company: string) => string
  questionSubject: (role: string, company: string) => string

  /** Los títulos de las secciones del mensaje largo. */
  posting: (url: string) => string
  whyShowing: string
  whyYou: string
  whatToConsider: string
  nothingSent: string

  /** Varias preguntas en un mensaje: lo normal en cuanto entran dos ofertas. */
  questionsSubject: (count: number) => string
  questionsLead: (count: number) => string
  questionItem: (role: string, company: string, question: string) => string[]
  questionsTailReply: string[]
  questionsTailScreen: (url: string) => string[]

  /** La pregunta, que es un mensaje mucho más pequeño. */
  questionLead: (role: string, company: string) => string
  questionTailScreen: (url: string) => string[]
  questionTailReply: string[]
  questionPromise: string

  /** Cómo se contesta una interrupción, según por dónde llegó. */
  answerOnScreen: (url: string) => string
  answerByCommand: string

  /** Por qué algo escrito no llegó a salir. */
  stale: {
    questionGone: string
    answeredFirst: string
    noLongerInterruption: string
  }

  /** Lo que contesta el bot cuando le escriben. */
  bot: {
    greeting: string[]
    /** " — Head of Growth en Ridgeline AI" */
    about: (role: string, company: string) => string
    unreadable: string
    /** No hay transcriptor montado, o el audio no se pudo leer. */
    voiceProblem: (reason: string) => string
    heard: (text: string) => string
    noted: (about: string) => string[]
    othersOpen: string[]
    alreadyAnswered: (about: string) => string[]
    needsYesNo: (about: string) => string[]
    waitingOnYou: (role: string, company: string) => string[]
    alreadyResponded: (about: string) => string
    /** Nada abierto, y aun así lo que escribió pasa al perfil. */
    notedAsContext: string[]
    nothingToYesNo: string
    severalWaiting: (count: number, url: string) => string[]
    heardThemOut: (about: string) => string[]
    notForMe: (about: string) => string[]
    couldNotWrite: (error: string) => string
    /** Era una pregunta y no se ha podido contestar. */
    couldNotAnswer: string
  }
}

const es: RepCopy = {
  interruptionSubject: (role, company) => `Algo para ti: ${role} en ${company}`,
  questionSubject: (role, company) => `Una cosa sobre ${role} en ${company}`,

  posting: (url) => `El anuncio: ${url}`,
  whyShowing: 'POR QUÉ TE LO ENSEÑO',
  whyYou: 'POR QUÉ TÚ',
  whatToConsider: 'LO QUE NO SÉ',
  nothingSent: 'No les he dicho nada, y no lo haré hasta que tú lo digas.',

  questionsSubject: (count) => `${count} cosas antes de decirte nada`,
  questionsLead: (count) =>
    `Me faltan ${count} cosas para decidir sobre lo que ha entrado. Van juntas para no ir molestándote de una en una:`,
  questionItem: (role, company, question) => [`${role} · ${company}`, question],
  questionsTailReply: [
    'Contéstame en un solo mensaje, o mándame un audio y lo transcribo. Con una frase por cada',
    'una vale.',
  ],
  questionsTailScreen: (url) => [`Contéstame aquí: ${url}/listening`],

  questionLead: (role, company) => `${role} en ${company}. Antes de decirte nada me falta una cosa:`,
  questionTailScreen: (url) => [`Contéstame aquí: ${url}/listening`],
  questionTailReply: ['Contéstame aquí, con lo que sea.'],
  questionPromise: 'Si con eso lo cierro, te digo qué he decidido. No les he dicho nada.',

  answerOnScreen: (url) => `Contéstame aquí: ${url}/listening`,
  answerByCommand: 'Contesta /si y les escucho, /no y fuera.',

  stale: {
    questionGone: 'La pregunta de la que iba ya no está.',
    answeredFirst: 'La contestó antes de que esto pudiera salir.',
    noLongerInterruption: 'Ya la contestó, o ha dejado de ser una interrupción.',
  },

  bot: {
    greeting: [
      'Soy tu Rep.',
      '',
      'Leo lo que va saliendo y lo comparo con lo que me dijiste que quieres. Casi nada llega',
      'hasta ti: ese es el trato. Cuando algo llega, te digo qué es, qué paga y qué tienes tú',
      'que hace que merezca la pena.',
      '',
      'Contesta /si y les escucho, /no y fuera.',
      '',
      'Y si me falta algo para decidir, te pregunto. Respondes al mensaje y ya está.',
    ],
    about: (role, company) => ` — ${role} en ${company}`,
    unreadable: 'Ahí no viene nada que pueda leer. Mándame texto o un audio.',
    voiceProblem: (reason) => `No he podido con el audio: ${reason}`,
    heard: (text) => `Te he entendido: «${text}»`,
    noted: (about) => [`Apuntado${about}.`, '', 'Si cambia lo que pienso de ese puesto, te aviso.'],
    othersOpen: ['', 'Hay más de una cosa abierta. Si querías otra, responde a su mensaje.'],
    alreadyAnswered: (about) => [
      `Esa ya la contestaste${about}.`,
      '',
      'Lo que has escrito ahora se suma a tu perfil igualmente.',
    ],
    needsYesNo: (about) => [`Esa${about} necesita un sí o un no.`, '', 'Contesta /si o /no.'],
    waitingOnYou: (role, company) => [
      `${role} en ${company} sigue esperándote.`,
      '',
      'Contesta /si y les escucho, /no y fuera.',
    ],
    alreadyResponded: (about) => `Esa ya me dijiste qué te parecía${about}.`,
    notedAsContext: [
      'No tenía nada abierto, pero eso no es una nota suelta: pasa a formar parte de lo que sé',
      'de ti, y lo tengo en cuenta en lo que llegue.',
      '',
      'Si cambia lo que pienso de algo que tengo en el aire, te aviso.',
    ],
    nothingToYesNo: 'No hay nada esperando un sí o un no. Ya te aviso cuando lo haya.',
    couldNotAnswer:
      'Ahora mismo no he podido contestarte. Lo he guardado: vuelve a preguntármelo en un rato.',
    severalWaiting: (count, url) => [
      `Hay ${count} esperando y no sé cuál dices.`,
      '',
      `Responde al mensaje de esa, o las tienes aquí: ${url}/listening`,
    ],
    heardThemOut: (about) => [
      `Hecho${about}.`,
      '',
      'No les he dicho nada: todavía no puedo hablar con una empresa por ti. Cuando pueda,',
      'empieza aquí.',
    ],
    notForMe: (about) => [
      `Fuera${about}.`,
      '',
      'No cambio lo que escucho por esto: un no es sobre ese puesto, no sobre lo que buscas.',
    ],
    couldNotWrite: (error) => `No he podido apuntarlo: ${error}`,
  },
}

const en: RepCopy = {
  interruptionSubject: (role, company) => `Something for you: ${role} at ${company}`,
  questionSubject: (role, company) => `One thing about ${role} at ${company}`,

  posting: (url) => `The posting: ${url}`,
  whyShowing: "WHY I'M SHOWING YOU THIS",
  whyYou: 'WHY YOU',
  whatToConsider: "WHAT I DON'T KNOW",
  nothingSent: 'Nothing has gone to them, and nothing will until you say so.',

  questionsSubject: (count) => `${count} things before I can tell you`,
  questionsLead: (count) =>
    `I need ${count} things to decide on what has come in. Together, so I am not pinging you one at a time:`,
  questionItem: (role, company, question) => [`${role} · ${company}`, question],
  questionsTailReply: [
    'Answer in one message, or send a voice note and I will transcribe it. A sentence each is',
    'plenty.',
  ],
  questionsTailScreen: (url) => [`Answer here: ${url}/listening`],

  questionLead: (role, company) =>
    `${role} at ${company}. One thing before I can tell you anything:`,
  questionTailScreen: (url) => [`Answer here: ${url}/listening`],
  questionTailReply: ['Just reply to this message, in a line.'],
  questionPromise: "If that closes it, I'll tell you what I decided. I haven't told them anything.",

  answerOnScreen: (url) => `Answer here: ${url}/listening`,
  answerByCommand: "Reply /yes and I'll hear them out, /no and it's gone.",

  stale: {
    questionGone: 'The question it was about is gone.',
    answeredFirst: 'They answered it before this could be sent.',
    noLongerInterruption: 'They answered it, or it is no longer an interruption.',
  },

  bot: {
    greeting: [
      "I'm your Rep.",
      '',
      'I read what goes past and hold it against what you told me you want. Almost none of it',
      'reaches you: that is the deal. When something does, I tell you what it is, what it pays,',
      'and what about you made it worth your evening.',
      '',
      "Reply /yes and I'll hear them out, /no and it's gone.",
      '',
      'And if I need something before I can decide, I ask. You reply, and that is it.',
    ],
    about: (role, company) => ` — ${role} at ${company}`,
    unreadable: 'Nothing I can read came through. Send me text or a voice note.',
    voiceProblem: (reason) => `I could not use that audio: ${reason}`,
    heard: (text) => `What I heard: "${text}"`,
    noted: (about) => [
      `Noted${about}.`,
      '',
      "If it changes what I think of that role, you'll hear from me.",
    ],
    othersOpen: ['', 'There is more than one thing open. If you meant another, reply to it.'],
    alreadyAnswered: (about) => [
      `You already answered that one${about}.`,
      '',
      'What you just wrote goes into your profile all the same.',
    ],
    needsYesNo: (about) => [`That one${about} needs a yes or a no.`, '', 'Reply /yes or /no.'],
    waitingOnYou: (role, company) => [
      `${role} at ${company} is still waiting on you.`,
      '',
      "Reply /yes and I'll hear them out, /no and it's gone.",
    ],
    alreadyResponded: (about) => `You already told me what you thought of that one${about}.`,
    notedAsContext: [
      "Nothing was open, but that is not a note in a drawer: it is part of what I know about",
      'you now, and I hold it against whatever comes in.',
      '',
      "If it changes what I think of something I'm sitting on, you'll hear from me.",
    ],
    nothingToYesNo: "There's nothing waiting for a yes or a no. I'll tell you when there is.",
    couldNotAnswer:
      "I could not answer that just now. I've kept it: ask me again in a while.",
    severalWaiting: (count, url) => [
      `There are ${count} waiting, so I don't know which you mean.`,
      '',
      `Reply to that one's message, or they are here: ${url}/listening`,
    ],
    heardThemOut: (about) => [
      `Done${about}.`,
      '',
      "Nothing has gone to them: I can't talk to a company on your behalf yet. When I can, it",
      'starts here.',
    ],
    notForMe: (about) => [
      `Gone${about}.`,
      '',
      "I haven't changed what I listen for. A no is about that job, not about what you want.",
    ],
    couldNotWrite: (error) => `I could not write that down: ${error}`,
  },
}

const COPY: Record<Language, RepCopy> = { es, en }

export function copyIn(language: Language = DEFAULT_LANGUAGE): RepCopy {
  return COPY[language] ?? COPY[DEFAULT_LANGUAGE]
}

/**
 * Lo que se le dice al modelo sobre en qué idioma escribir.
 *
 * El titular, el porqué y las preguntas los escribe el modelo, así que la
 * mitad del producto está en su idioma y no en el nuestro. Cambiar el
 * diccionario sin cambiar esto deja una pantalla en castellano con un
 * titular en inglés.
 */
export function languageInstruction(language: Language = DEFAULT_LANGUAGE): string {
  return language === 'es'
    ? 'Write every word the person will read in Spanish (Spain), natural and brief, addressing them as "tú". Keep role titles, company names and technologies as they are written. JSON keys and ids stay exactly as specified, in English.'
    : 'Write every word the person will read in English, natural and brief.'
}

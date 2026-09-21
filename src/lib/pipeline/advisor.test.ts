/**
 * Que conteste cuando le preguntan, y con qué.
 *
 * Tres cosas. Que una pregunta se distinga de una afirmación sin llamar al
 * modelo para averiguarlo —una llamada para decidir si hace falta otra
 * llamada es cómo esto cuesta el doble sin ser el doble de listo—. Que lo que
 * el modelo recibe sea el grafo y nada más, porque lo que no esté ahí es
 * exactamente lo que no puede afirmar. Y que una pregunta contestada no se
 * vuelva a pagar.
 *
 * El caso que da nombre a todo esto: hasta hoy, preguntarle algo al Rep te
 * devolvía «apuntado». Le preguntabas y te archivaba.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

type Advisor = typeof import('./advisor')
type InboundDb = typeof import('../db/inbound')
type Repo = typeof import('../db/repo')
type Preferences = typeof import('./preferences')
type AdviceDb = typeof import('../db/advice')

let advisor: Advisor
let inboundDb: InboundDb
let repo: Repo
let preferences: Preferences
let advice: AdviceDb
let candidateId: string
let workingDirectory: string
let previousDirectory: string

/** Lo que el modelo recibió, para poder mirarlo. */
let prompts: string[] = []
let calls = 0
/** Lo que el modelo propone recordar de la conversación. */
let proposedMemory: unknown[] = []
/** Lo que el modelo dice, con lo que dice que lo sostiene. */
let proposedPoints: unknown[] = []

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-advisor-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'
  process.env.AMBLE_MODEL_API_KEY = 'test-key'
  process.env.AMBLE_MODEL_ID = 'test-model'

  advisor = await import('./advisor')
  inboundDb = await import('../db/inbound')
  repo = await import('../db/repo')
  preferences = await import('./preferences')
  advice = await import('../db/advice')

  candidateId = repo.getOrCreateCandidate().id

  const evidence = repo.insertEvidence({
    id: 'ev_community',
    candidate_id: candidateId,
    claim_id: null,
    statement: 'Ran a developer community of 120,000 people.',
    epistemic_state: 'ESTABLISHED',
    source_type: 'cv',
    source_id: null,
    source_excerpt: null,
    strength: 'strong',
    confidence: 0.9,
    candidate_confirmed: 1,
    human_verified: 0,
    interview_turn_id: null,
  })
  repo.upsertCapability(
    candidateId,
    'cap_community',
    'Developer community',
    'STRONG',
    'Ran one of 120,000 people for three years.',
  )
  repo.linkCapabilityEvidence(candidateId, 'cap_community', [evidence.id])
  repo.insertUncertainty({
    id: 'unk_team',
    candidate_id: candidateId,
    capability_id: 'cap_community',
    description: 'We do not know whether he has managed a team of more than five.',
    reason: 'Every posting at this level asks for it.',
    materiality: 'HIGH',
    status: 'OPEN',
    resolvable_by_interview: 1,
  })
  preferences.writePreferences(candidateId, { salaryMin: 120_000, salaryCurrency: 'EUR' })

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    calls += 1
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages: { role: string; content: string }[]
    }
    prompts.push(body.messages.map((message) => message.content).join('\n'))
    const content = JSON.stringify({
      points: proposedPoints,
      askBack: null,
      unknowns: ['Si has llevado un equipo de más de cinco.'],
      remember: proposedMemory,
    })
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch
})

after(() => {
  process.chdir(previousDirectory)
  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open a moment longer than we care about.
  }
})

beforeEach(() => {
  prompts = []
  calls = 0
  proposedMemory = []
  // Por defecto, algo que se sostiene de verdad: el hueco existe en el grafo.
  proposedPoints = [
    {
      text: 'Te falta un caso de gestión de equipo. Lo de la comunidad ya lo tienes.',
      evidenceIds: [],
      uncertaintyIds: ['unk_team'],
      opportunityIds: [],
    },
  ]
})

let nextId = 500

function arrive(text: string): string {
  nextId += 1
  return inboundDb.claimInboundMessage({
    candidate_id: candidateId,
    channel: 'web',
    external_id: String(nextId),
    chat_id: 'web',
    sender: null,
    text,
    outcome: 'answered_by_rep',
  }).message.id
}

describe('distinguir una pregunta de una afirmación', () => {
  it('ve la pregunta por el signo, en los dos idiomas y con el de apertura', () => {
    assert.equal(advisor.looksLikeAQuestion('¿Qué me falta para un Head of Growth?'), true)
    assert.equal(advisor.looksLikeAQuestion('what should I learn next?'), true)
  })

  it('la ve también sin signo, por cómo empieza', () => {
    assert.equal(advisor.looksLikeAQuestion('me recomiendas algo para el perfil'), true)
    assert.equal(advisor.looksLikeAQuestion('should I move for this one'), true)
  })

  it('no toma por pregunta lo que le está contando', () => {
    assert.equal(advisor.looksLikeAQuestion('Ya no quiero guardias.'), false)
    assert.equal(advisor.looksLikeAQuestion('Monté la comunidad de Manfred, 120k devs.'), false)
    assert.equal(advisor.looksLikeAQuestion('   '), false)
  })
})

describe('reconocer que te están pasando una oferta', () => {
  it('ve el enlace suelto', () => {
    const found = advisor.offerInMessage('mira esta https://jobs.example.com/head-of-growth')
    assert.equal(found.url, 'https://jobs.example.com/head-of-growth')
  })

  it('ve el anuncio pegado entero, por tamaño y no por palabras', () => {
    // Adivinar si dice «oferta» o «vacante» es adivinar el vocabulario de
    // alguien, y falla justo con quien escribe raro.
    assert.equal(advisor.offerInMessage('x'.repeat(1200)).pasted, true)
  })

  it('no confunde una frase con un enlace con un anuncio pegado', () => {
    const found = advisor.offerInMessage('¿qué te parece https://example.com/a?')
    assert.equal(found.pasted, false, 'el texto que queda es una frase')
    assert.ok(found.url)
  })

  it('deja en paz un mensaje normal', () => {
    const found = advisor.offerInMessage('Ya no quiero guardias.')
    assert.equal(found.url, null)
    assert.equal(found.pasted, false)
  })
})

describe('con qué contesta', () => {
  it('le da el grafo entero y nada más', () => {
    const digest = advisor.profileDigest(candidateId)

    assert.match(digest, /Developer community/, 'las capacidades')
    assert.match(digest, /managed a team of more than five/, 'y sobre todo lo que no sabe')
    assert.match(digest, /120000 EUR/, 'y sus condiciones')
  })

  it('manda lo que no sabe de él, que es la mitad útil para aconsejar', async () => {
    await advisor.answerQuestionJob(candidateId, arrive('¿Qué me falta para una Serie B?'))

    // Un consejo es casi siempre «esto que no se sabe de ti es lo que te
    // está costando». Sin los huecos en el prompt, no hay consejo: hay
    // halago.
    assert.match(prompts.join('\n'), /WHAT IS NOT KNOWN ABOUT THEM YET/)
  })

  it('le prohíbe hablar del mercado, que no ha visto', async () => {
    await advisor.answerQuestionJob(candidateId, arrive('¿Cuánto debería pedir?'))
    assert.match(prompts.join('\n'), /NO OTHERS/)
  })
})

describe('contestar', () => {
  it('guarda lo que dijo, para poder releerlo', async () => {
    const id = arrive('¿Y para un puesto más senior?')

    const result = await advisor.answerQuestionJob(candidateId, id)

    assert.match(result.answer, /gestión de equipo/)
    assert.equal(inboundDb.getInboundMessage(id)?.answer, result.answer)
    assert.ok(inboundDb.getInboundMessage(id)?.answered_at)
    // Y con lo que lo sostiene al lado, guardado: una fuente que se
    // recalcula mañana con otro grafo ya no es la fuente de lo de ayer.
    assert.deepEqual(
      JSON.parse(inboundDb.getInboundMessage(id)?.answer_sources ?? '[]')[0].uncertaintyIds,
      ['unk_team'],
    )
  })

  it('no vuelve a pagar una pregunta ya contestada', async () => {
    const id = arrive('¿Me cambio de sector?')

    await advisor.answerQuestionJob(candidateId, id)
    const first = calls
    const again = await advisor.answerQuestionJob(candidateId, id)

    assert.equal(calls, first, 'el reintento no llama al modelo')
    assert.equal(again.answer, inboundDb.getInboundMessage(id)?.answer)
  })

  it('le enseña lo que ya le había dicho, para no repetirse', async () => {
    await advisor.answerQuestionJob(candidateId, arrive('¿Y ahora qué?'))
    assert.match(prompts.join('\n'), /WHAT YOU HAVE ALREADY TOLD THEM/)
    assert.match(prompts.join('\n'), /YOU SAID/)
  })
})

describe('lo que queda dicho entre los dos', () => {
  it('guarda el consejo que cita un hueco de verdad', async () => {
    proposedMemory = [
      {
        side: 'rep',
        text: 'Te falta enseñar que has llevado un equipo.',
        uncertaintyIds: ['unk_team'],
        opportunityIds: [],
      },
    ]

    const result = await advisor.answerQuestionJob(candidateId, arrive('¿Y para liderar?'))

    assert.equal(result.remembered.length, 1)
    assert.equal(result.remembered[0].side, 'rep')
    assert.equal(advice.listOpenAdvice(candidateId).length, 1)
  })

  it('tira el que no puede citar nada, que es un horóscopo', async () => {
    proposedMemory = [
      { side: 'rep', text: 'Sigue así, vas muy bien.', uncertaintyIds: [], opportunityIds: [] },
      {
        side: 'rep',
        text: 'Y apúntate a un curso.',
        uncertaintyIds: ['unk_no_existe'],
        opportunityIds: [],
      },
    ]
    const before = advice.listOpenAdvice(candidateId).length

    const result = await advisor.answerQuestionJob(candidateId, arrive('¿Qué tal voy?'))

    assert.equal(result.remembered.length, 0, 'ninguno cita algo que exista')
    assert.equal(advice.listOpenAdvice(candidateId).length, before)
  })

  it('le enseña al modelo los ids que puede citar', async () => {
    await advisor.answerQuestionJob(candidateId, arrive('¿Por dónde sigo?'))

    // Sin los ids delante no puede citar nada, y entonces todo lo que
    // proponga se cae en la comprobación y la memoria sale siempre vacía.
    assert.match(prompts.join('\n'), /\[unk_team\]/)
    assert.match(prompts.join('\n'), /cite these ids/)
  })

  it('le enseña lo que sigue en pie, para no repetirse', async () => {
    proposedMemory = []
    await advisor.answerQuestionJob(candidateId, arrive('¿Alguna idea más?'))

    assert.match(prompts.join('\n'), /WHAT IS STILL OPEN BETWEEN YOU/)
    assert.match(prompts.join('\n'), /YOU ADVISED: Te falta enseñar que has llevado un equipo/)
  })
})

describe('las fuentes, comprobadas de verdad', () => {
  it('tira lo que cita un hueco que no existe, aunque suene bien', async () => {
    proposedPoints = [
      {
        text: 'El mercado está pagando más por perfiles como el tuyo.',
        evidenceIds: [],
        uncertaintyIds: ['unk_no_existe'],
        opportunityIds: [],
      },
    ]

    const result = await advisor.answerQuestionJob(candidateId, arrive('¿Cuánto pido?'))

    assert.equal(result.points.length, 0)
    assert.equal(result.dropped, 1)
    // Y lo que se le enseña lo dice, en vez de rellenar con algo amable.
    assert.match(result.answer, /no puedo contestarte eso sin inventármelo/i)
  })

  it('no deja ni un id suelto en lo que se lee', async () => {
    proposedPoints = [
      {
        text: 'Falta enseñar equipo (unk_team).',
        evidenceIds: [],
        uncertaintyIds: ['unk_team'],
        opportunityIds: [],
      },
    ]

    const result = await advisor.answerQuestionJob(candidateId, arrive('¿Y el equipo?'))

    assert.doesNotMatch(result.answer, /unk_|ev_|opp_/)
    assert.deepEqual(result.points[0].uncertaintyIds, ['unk_team'])
  })
})

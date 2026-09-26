import type { CandidateRow, EvidenceRow, RetractionRow, SourceRow, UncertaintyRow } from '@/lib/db/repo'
import type { CareerProfileOutput } from '@/lib/career/synthesis'

// A fictional candidate for the career.md example. Every name, company and
// figure here is invented (PRODUCT_SPEC §13: example facts are fixtures only).
//
// The fixture is built to exercise every rule the renderer enforces:
//   - statements grounded in sole, sourced and interview evidence
//   - an assisted claim still undefended (flagged ⚠️)
//   - an assisted claim the candidate defended (promoted, not flagged)
//   - a retracted claim: absent from evidence, present in the audit section
//   - a model statement citing the retracted claim, and one citing nothing
//     real: both must be dropped
//   - a contradiction between two sources
//   - open uncertainty of both kinds, and a resolved one that must not show

const CANDIDATE_ID = 'example'
const T = '2026-09-01T10:00:00.000Z'

export const exampleCandidate: CandidateRow = {
  id: CANDIDATE_ID,
  name: 'Marta Quiroga Lez',
  descriptor: 'Developer relations · Developer tooling · Technical content',
  descriptor_grounded: 1,
  locale: 'es',
  locale_source: 'chosen',
  created_at: T,
}

function source(id: string, type: string, name: string): SourceRow {
  return {
    id,
    candidate_id: CANDIDATE_ID,
    type,
    name,
    uri: null,
    original_filename: null,
    mime_type: null,
    stored_path: null,
    char_count: null,
    status: 'processed',
    status_detail: null,
    created_at: T,
    processed_at: T,
  }
}

export const exampleSources: SourceRow[] = [
  source('src_cv', 'cv', 'CV_Marta_Quiroga_2026.pdf'),
  source('src_li', 'linkedin', 'Perfil de LinkedIn'),
  source('src_gh', 'github', 'mquiroga'),
  source('src_web', 'website', 'martaquiroga.example'),
]

type EvidenceSeed = Pick<EvidenceRow, 'id' | 'statement' | 'epistemic_state' | 'source_type'> &
  Partial<EvidenceRow>

function evidence(seed: EvidenceSeed): EvidenceRow {
  const assisted = seed.source_type === 'github'
  return {
    candidate_id: CANDIDATE_ID,
    claim_id: null,
    source_id: null,
    source_excerpt: null,
    strength: 'some',
    confidence: 0.9,
    corroborated_by: '[]',
    contradicted_by: '[]',
    candidate_confirmed: seed.epistemic_state === 'USER_CLAIM' ? 1 : 0,
    human_verified: 0,
    interview_turn_id: null,
    attribution: assisted ? 'assisted' : 'sole',
    attribution_tool: null,
    defence_status: null,
    defence_turn_id: null,
    retracted_at: null,
    retracted_reason: null,
    retracted_by_turn: null,
    created_at: T,
    updated_at: T,
    ...seed,
  }
}

// What listEvidence returns: retracted evidence is already excluded.
export const exampleEvidence: EvidenceRow[] = [
  evidence({ id: 'ev_01', source_type: 'cv', epistemic_state: 'USER_CLAIM', statement: 'Lidera developer relations en Farolillo Labs desde 2024.' }),
  evidence({ id: 'ev_02', source_type: 'linkedin', epistemic_state: 'USER_CLAIM', statement: 'Developer Advocate en Farolillo Labs desde marzo de 2024.' }),
  evidence({ id: 'ev_03', source_type: 'cv', epistemic_state: 'USER_CLAIM', statement: 'Creó el programa de embajadores de Farolillo: 40 embajadores en 9 países.' }),
  evidence({ id: 'ev_04', source_type: 'interview', epistemic_state: 'USER_CLAIM', statement: 'Diseñó los criterios de entrada del programa y rechazó a la mitad de los candidatos del primer año.' }),
  evidence({ id: 'ev_05', source_type: 'website', epistemic_state: 'SOURCE_FACT', statement: 'Farolillo Labs publica una CLI de observabilidad para equipos de plataforma.' }),
  evidence({ id: 'ev_06', source_type: 'cv', epistemic_state: 'USER_CLAIM', statement: 'Content Lead en Tramontana Data entre 2019 y 2024.' }),
  evidence({ id: 'ev_07', source_type: 'linkedin', epistemic_state: 'USER_CLAIM', statement: 'Content Lead en Tramontana Data entre 2020 y 2024.' }),
  evidence({ id: 'ev_08', source_type: 'website', epistemic_state: 'USER_CLAIM', statement: 'Escribe una newsletter técnica quincenal sobre tooling de plataforma, con 3.100 suscriptores.' }),
  evidence({ id: 'ev_09', source_type: 'interview', epistemic_state: 'USER_CLAIM', statement: 'Escribe primero la guía de migración y después el anuncio: si la guía no se sostiene, no hay lanzamiento.' }),
  evidence({ id: 'ev_10', source_type: 'github', epistemic_state: 'SOURCE_FACT', statement: 'El repositorio mquiroga/sonda es una CLI en Go con 212 estrellas, creado en 2025.' }),
  evidence({
    id: 'ev_11',
    source_type: 'github',
    epistemic_state: 'ASSISTED_CLAIM',
    defence_status: 'undefended',
    strength: 'limited',
    statement: 'Diseñó la arquitectura de plugins de sonda para que terceros añadan exportadores.',
  }),
  evidence({
    id: 'ev_12',
    source_type: 'github',
    epistemic_state: 'USER_CLAIM',
    defence_status: 'defended',
    defence_turn_id: 'turn_ex_02',
    statement: 'Decidió que sonda no guarde credenciales en disco y las lea solo del entorno.',
  }),
  evidence({ id: 'ev_13', source_type: 'cv', epistemic_state: 'USER_CLAIM', statement: 'Grado en Periodismo por la Universidad de Valdemar, 2018.' }),
]

export const exampleRetractions: RetractionRow[] = [
  {
    id: 'ret_ex_01',
    candidate_id: CANDIDATE_ID,
    evidence_id: 'ev_14',
    statement: 'Optimizó el rendimiento del parser de sonda con un algoritmo de streaming propio.',
    question: 'En sonda, el parser procesa por bloques en lugar de cargar el fichero entero. ¿Por qué ahí y no en el exportador?',
    answer: 'No lo sé, esa parte la escribió el agente. Yo solo comprobé que funcionaba con ficheros grandes.',
    reason: 'Atribuye la decisión al agente y no da razones propias; comprobar que funciona no es decidir cómo.',
    turn_id: 'turn_ex_01',
    previous_state: 'ASSISTED_CLAIM',
    created_at: T,
  },
]

function uncertainty(seed: Pick<UncertaintyRow, 'id' | 'description' | 'materiality' | 'status' | 'kind'>): UncertaintyRow {
  return {
    candidate_id: CANDIDATE_ID,
    capability_id: null,
    reason: null,
    resolvable_by_interview: 1,
    created_at: T,
    resolved_at: seed.status === 'OPEN' ? null : T,
    resolved_by_turn: null,
    ...seed,
  }
}

export const exampleUncertainties: UncertaintyRow[] = [
  uncertainty({
    id: 'unc_ex_01',
    kind: 'ATTRIBUTION',
    materiality: 'HIGH',
    status: 'OPEN',
    description: 'No sé de quién es el criterio detrás de "Herramientas para desarrolladores": 1 de 2 evidencias sale de trabajo co-producido con IA y nadie la ha defendido.',
  }),
  uncertainty({
    id: 'unc_ex_02',
    kind: 'MATERIALITY',
    materiality: 'MEDIUM',
    status: 'OPEN',
    description: 'No sé si el programa de embajadores generó adopción medible o solo visibilidad.',
  }),
  uncertainty({
    id: 'unc_ex_03',
    kind: 'MATERIALITY',
    materiality: 'HIGH',
    status: 'RESOLVED',
    description: 'No sabía si el programa de embajadores lo diseñó ella o lo heredó.',
  }),
]

// What the synthesis model proposed. The renderer decides what survives.
export const exampleProfile: CareerProfileOutput = {
  headline: 'Developer relations para herramientas de plataforma: comunidad, contenido y una CLI propia.',
  oneLiner: {
    text: 'Hace que los equipos de plataforma adopten herramientas explicándolas antes de anunciarlas.',
    evidenceIds: ['ev_09', 'ev_08'],
  },
  howIWork: [
    { text: 'Escribe la guía de migración antes que el anuncio, y sin guía no hay lanzamiento.', evidenceIds: ['ev_09'] },
    { text: 'Filtra la entrada a sus programas: en el primer año rechazó a la mitad de los candidatos a embajador.', evidenceIds: ['ev_04'] },
    // Cites nothing that exists: dropped.
    { text: 'Prioriza la experiencia de desarrollador por encima de las métricas de vanidad.', evidenceIds: ['ev_99'] },
  ],
  trajectory: [
    {
      organisation: 'Farolillo Labs',
      role: 'Developer Relations Lead',
      period: '2024 —',
      bullets: [
        { text: 'Creó el programa de embajadores: 40 embajadores en 9 países.', evidenceIds: ['ev_03', 'ev_04'] },
        { text: 'Lidera la relación con desarrolladores de una CLI de observabilidad para equipos de plataforma.', evidenceIds: ['ev_01', 'ev_02', 'ev_05'] },
      ],
    },
    {
      organisation: 'Tramontana Data',
      role: 'Content Lead',
      period: '2019 — 2024',
      bullets: [{ text: 'Dirigió el contenido técnico durante cinco años.', evidenceIds: ['ev_06'] }],
    },
  ],
  education: [
    { title: 'Grado en Periodismo', institution: 'Universidad de Valdemar', date: '2018', evidenceIds: ['ev_13'] },
  ],
  shipped: [
    {
      name: 'sonda',
      description: { text: 'CLI de observabilidad en Go con arquitectura de plugins para exportadores de terceros.', evidenceIds: ['ev_10', 'ev_11'] },
    },
    {
      name: 'sonda · credenciales',
      description: { text: 'Decidió que la herramienta no guarde credenciales en disco y las lea solo del entorno.', evidenceIds: ['ev_12'] },
    },
    {
      // Rests only on the retracted claim: dropped.
      name: 'sonda · parser',
      description: { text: 'Parser por bloques de diseño propio para ficheros grandes.', evidenceIds: ['ev_14'] },
    },
  ],
  contradictions: [
    {
      title: 'Fecha de entrada en Tramontana Data',
      sides: [
        { text: 'El CV dice 2019.', evidenceIds: ['ev_06'] },
        { text: 'LinkedIn dice 2020.', evidenceIds: ['ev_07'] },
      ],
      reading: 'Puede que 2019 cuente un periodo freelance previo al contrato. Solo ella puede confirmarlo.',
    },
  ],
}

export const exampleCareer = {
  profile: exampleProfile,
  candidate: exampleCandidate,
  evidence: exampleEvidence,
  sources: exampleSources,
  uncertainties: exampleUncertainties,
  retractions: exampleRetractions,
  generatedAt: new Date('2026-09-01T10:00:00.000Z'),
}

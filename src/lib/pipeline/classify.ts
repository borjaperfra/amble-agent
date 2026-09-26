import { z } from 'zod'
import { runStructuredTask } from '../model/provider'
import { serverText } from '../i18n/candidate'

// A file's type is decided by what is inside it, never by how it arrived or what
// it is called. A PDF named BORJA.pdf turned out to be a quote for PVC windows;
// a file uploaded through the CV field is routinely a LinkedIn export.

export type ClassifiedType = 'cv' | 'linkedin' | 'website' | 'other'

export interface Classification {
  type: ClassifiedType
  isProfessional: boolean
  reason: string
  certain: boolean
}

interface Signature {
  type: ClassifiedType
  // Resolved when used, so it reads in the candidate's current language.
  describe: () => string
  test: (content: string) => boolean
}

function countMarkers(content: string, markers: RegExp[]): number {
  return markers.filter((marker) => marker.test(content)).length
}

// Deterministic detection for formats with a reliable fingerprint. These run at
// upload time, cost nothing and cannot hallucinate.
const SIGNATURES: Signature[] = [
  {
    type: 'linkedin',
    describe: () => serverText().linkedinExport,
    test: (content) =>
      /linkedin\.com\/in\//i.test(content) &&
      countMarkers(content, [
        /\b(Contactar|Contact)\b/i,
        /\b(Aptitudes principales|Top Skills)\b/i,
        /\b(Extracto|Summary)\b/i,
        /\b(Experiencia|Experience)\b/i,
        /\bPage \d+ of \d+\b/i,
      ]) >= 3,
  },
]

export function detectSourceSignature(content: string): Signature | null {
  const head = content.slice(0, 6000)
  return SIGNATURES.find((signature) => signature.test(head)) ?? null
}

const classifySourceOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const rawType = typeof obj.type === 'string' ? obj.type.toLowerCase().trim() : ''
    return {
      type: (['cv', 'linkedin', 'website', 'other'] as const).includes(rawType as ClassifiedType)
        ? rawType
        : 'other',
      isProfessional: obj.isProfessional === true,
      reason:
        typeof obj.reason === 'string' && obj.reason.trim().length > 0
          ? obj.reason.trim().slice(0, 300)
          : serverText().noReasonGiven,
    }
  },
  z.object({
    type: z.enum(['cv', 'linkedin', 'website', 'other']),
    isProfessional: z.boolean(),
    reason: z.string().min(1).max(300),
  }),
)

const SYSTEM_PROMPT = `You are Amble's source classifier, version 1. You are given the beginning of a document a candidate uploaded. Decide what it actually is, from its content alone. The filename is not given to you on purpose.

Types:
- "cv": a curriculum vitae or résumé, written to present one person's career.
- "linkedin": an export of a LinkedIn profile.
- "website": a page, article or post about the person or their work.
- "other": anything else.

isProfessional: true only if the document is about a person's professional life and could legitimately support claims about their career. An invoice, a quote, a contract, a ticket, a bank statement, a manual or a document about someone else is NOT professional evidence, even when the candidate's name appears on it.

Be strict. A document that merely mentions a name is not evidence about that person's career.

reason: one sentence explaining the decision, naming the concrete signal you used.

Respond ONLY with JSON: {"type": "cv"|"linkedin"|"website"|"other", "isProfessional": boolean, "reason": string}.`

export async function classifySourceContent(params: {
  candidateId: string
  content: string
}): Promise<Classification> {
  const signature = detectSourceSignature(params.content)
  if (signature) {
    return { type: signature.type, isProfessional: true, reason: signature.describe(), certain: true }
  }

  const { data } = await runStructuredTask({
    candidateId: params.candidateId,
    task: 'classify_source',
    version: 'v1',
    system: SYSTEM_PROMPT,
    user: `DOCUMENT (first 4000 characters):\n${params.content.slice(0, 4000)}`,
    schema: classifySourceOutputSchema,
    temperature: 0.1,
  })

  return { ...data, certain: false }
}

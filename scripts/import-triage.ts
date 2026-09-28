// Imports a triage that was run outside the product (offers plus the literal
// answers) into the database, through the same validation the API applies.
//
//   npx tsx scripts/import-triage.ts path/to/triage.json
//
// The file holds personal answers: keep it out of the repository (.amble-data/).

import fs from 'node:fs'
import { z } from 'zod'
import { answerProbe, createTriage, createTriageInputSchema, getTriageView, VERDICTS } from '../src/lib/pipeline/triage'
import { getOrCreateCandidate } from '../src/lib/db/repo'

const answerSchema = z.object({
  verdict: z.enum(VERDICTS),
  conditions: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
})

const file = process.argv[2]
if (!file) {
  console.error('Usage: npx tsx scripts/import-triage.ts path/to/triage.json')
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { probes?: { answer?: unknown }[] }
const input = createTriageInputSchema.parse(raw)
const answers = (raw.probes ?? []).map((probe) => (probe.answer === undefined ? null : answerSchema.parse(probe.answer)))

const candidateId = getOrCreateCandidate().id
const triage = createTriage(candidateId, input)
const view = getTriageView(candidateId, triage.id)
if (!view) throw new Error('The triage was created but cannot be read back.')

view.probes.forEach((probe, idx) => {
  const answer = answers[idx]
  if (answer) answerProbe(candidateId, { probeId: probe.id, ...answer })
})

const answered = answers.filter(Boolean).length
console.log(`Imported triage ${triage.id}: ${view.probes.length} offers, ${answered} answered.`)

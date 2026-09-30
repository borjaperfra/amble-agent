import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY, getDb } from '../db/db'
import { newId, now } from '../db/repo'
import { activeContent, documentKind } from '../files'
import { carriesMachineText } from '../pipeline/sources'

// What the candidate answers themselves in application forms, kept so the
// next form that asks the same thing already has it: where they live, visas,
// consents, their LinkedIn, their phone. And the CV they send, as a file.
//
// An answer is keyed by its question as written, normalised: "Where are you
// currently based?" on two forms is one answer.

export function questionKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function savedAnswers(candidateId: string): Record<string, string> {
  const rows = getDb().prepare('SELECT question_key, answer FROM candidate_answers WHERE candidate_id = ?').all(candidateId) as {
    question_key: string
    answer: string
  }[]
  return Object.fromEntries(rows.map((row) => [row.question_key, row.answer]))
}

export function saveAnswer(candidateId: string, label: string, answer: string): void {
  const value = answer.trim().slice(0, 3000)
  const db = getDb()
  if (!value) {
    db.prepare('DELETE FROM candidate_answers WHERE candidate_id = ? AND question_key = ?').run(candidateId, questionKey(label))
    return
  }
  db.prepare(
    `INSERT INTO candidate_answers (candidate_id, question_key, question, answer, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (candidate_id, question_key) DO UPDATE SET question = excluded.question, answer = excluded.answer, updated_at = excluded.updated_at`,
  ).run(candidateId, questionKey(label), label, value, now())
}

// ── The CV they send ─────────────────────────────────────────────────────

const MAX_CV_BYTES = 8 * 1024 * 1024

export interface ApplicationCv {
  id: string
  filename: string
  path: string
  created_at: string
}

// The CV sent with applications: one uploaded for that, or else the most
// recent CV they gave when building their Rep, as they gave it: only one
// read and taken as theirs, so a file set aside (an invoice, someone else's
// CV) never reaches a company.
export function applicationCv(candidateId: string): ApplicationCv | null {
  const db = getDb()
  const row = db
    .prepare("SELECT id, filename, stored_path AS path, created_at FROM application_files WHERE candidate_id = ? AND kind = 'cv' ORDER BY created_at DESC LIMIT 1")
    .get(candidateId) as ApplicationCv | undefined
  if (row && fs.existsSync(row.path)) return row
  const sources = db
    .prepare("SELECT id, name, created_at FROM sources WHERE candidate_id = ? AND type = 'cv' AND status = 'processed' AND flag IS NULL ORDER BY created_at DESC")
    .all(candidateId) as { id: string; name: string; created_at: string }[]
  for (const source of sources) {
    const original = path.join(DATA_DIRECTORY, 'uploads', `${source.id}.original.pdf`)
    if (!fs.existsSync(original)) continue
    // Read for their map, but not sent on: it carries something that runs.
    if (activeContent(fs.readFileSync(original), 'pdf')) continue
    return { id: source.id, filename: source.name, path: original, created_at: source.created_at }
  }
  return null
}

export class CvRejectedError extends Error {}

export async function storeApplicationCv(candidateId: string, file: File): Promise<ApplicationCv> {
  if (file.size > MAX_CV_BYTES) throw new CvRejectedError('The CV must be under 8 MB.')
  const bytes = Buffer.from(await file.arrayBuffer())
  // What it is comes from its bytes, not from the type the browser gave.
  const kind = documentKind(bytes)
  if (!kind) throw new CvRejectedError('The CV must be a PDF or a Word (.docx) document.')
  const unsafe = activeContent(bytes, kind)
  if (unsafe) throw new CvRejectedError(`The CV carries ${unsafe}, which companies' systems block. Export it again as a plain PDF.`)
  if (kind === 'pdf' && (await carriesMachineText(bytes))) {
    throw new CvRejectedError("The CV carries hidden text or instructions for automated systems; companies' filters tend to set such CVs aside. Upload a version without them.")
  }
  const id = newId('file')
  const extension = `.${kind}`
  const directory = path.join(DATA_DIRECTORY, 'files', candidateId)
  fs.mkdirSync(directory, { recursive: true })
  const stored = path.join(directory, `${id}${extension}`)
  fs.writeFileSync(stored, bytes)
  // The name the company will see is the one the candidate gave the file,
  // ending as what it really is.
  const given = path.basename(file.name).slice(0, 120).replace(/\.(pdf|docx?)$/i, '')
  const filename = `${given || 'CV'}${extension}`
  getDb()
    .prepare("INSERT INTO application_files (id, candidate_id, kind, filename, stored_path, created_at) VALUES (?, ?, 'cv', ?, ?, ?)")
    .run(id, candidateId, filename, stored, now())
  return applicationCv(candidateId) as ApplicationCv
}

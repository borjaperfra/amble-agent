import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY, getDb } from './db/db'

// A person's data, all of it, for the rights the privacy policy promises
// (GDPR arts. 15, 17 and 20): a copy they can take, and an account that goes
// away completely. Every table with a candidate_id column is theirs; reading
// the schema instead of listing tables means a new table is never forgotten.
// Their files live on the volume by source, in their own folder, and beside
// each application. The daily copies of the database keep them for the
// days the policy says (backup.ts keeps seven), then they are gone too.

// Stored secrets and hashes are no one's data to take away.
const SECRET_COLUMNS = new Set(['token', 'token_hash', 'code_hash', 'link_hash'])

function candidateTables(): string[] {
  const db = getDb()
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as unknown as { name: string }[]
  return tables
    .map((table) => table.name)
    .filter((name) => (db.prepare(`PRAGMA table_info(${name})`).all() as unknown as { name: string }[]).some((column) => column.name === 'candidate_id'))
}

function withoutSecrets(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !SECRET_COLUMNS.has(key))))
}

function interviewIds(candidateId: string): string[] {
  const rows = getDb().prepare('SELECT id FROM interviews WHERE candidate_id = ?').all(candidateId) as unknown as { id: string }[]
  return rows.map((row) => row.id)
}

function sourceIds(candidateId: string): string[] {
  const rows = getDb().prepare('SELECT id FROM sources WHERE candidate_id = ?').all(candidateId) as unknown as { id: string }[]
  return rows.map((row) => row.id)
}

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ')

export function exportAccount(candidateId: string): Record<string, unknown> {
  const db = getDb()
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown> | undefined
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), candidate }
  for (const table of candidateTables()) {
    data[table] = withoutSecrets(db.prepare(`SELECT * FROM ${table} WHERE candidate_id = ?`).all(candidateId) as unknown as Record<string, unknown>[])
  }
  const interviews = interviewIds(candidateId)
  data.interview_turns =
    interviews.length > 0 ? db.prepare(`SELECT * FROM interview_turns WHERE interview_id IN (${placeholders(interviews)})`).all(...interviews) : []
  data.invitations = withoutSecrets(
    db.prepare('SELECT * FROM invitations WHERE inviter_id = ? OR accepted_by = ?').all(candidateId, candidateId) as unknown as Record<string, unknown>[],
  )
  // The text read from each thing they shared, as amble read it.
  data.sourceTexts = Object.fromEntries(
    sourceIds(candidateId).flatMap((id) => {
      const file = path.join(DATA_DIRECTORY, 'uploads', `${id}.txt`)
      return fs.existsSync(file) ? [[id, fs.readFileSync(file, 'utf8')]] : []
    }),
  )
  return data
}

export function deleteAccount(candidateId: string): void {
  const db = getDb()
  const email = (db.prepare('SELECT email FROM candidates WHERE id = ?').get(candidateId) as { email: string | null } | undefined)?.email ?? null
  const sources = sourceIds(candidateId)
  const interviews = interviewIds(candidateId)

  // One transaction, with foreign keys checked only at the end: the tables
  // refer to one another, and all of them go.
  db.exec('PRAGMA defer_foreign_keys = ON')
  db.exec('BEGIN IMMEDIATE')
  try {
    if (interviews.length > 0) db.prepare(`DELETE FROM interview_turns WHERE interview_id IN (${placeholders(interviews)})`).run(...interviews)
    // Invitations they sent and nobody used go; the accounts of those who
    // joined with one stay, no longer linked to them.
    db.prepare('DELETE FROM invitations WHERE inviter_id = ? AND accepted_by IS NULL').run(candidateId)
    db.prepare('UPDATE invitations SET inviter_id = NULL WHERE inviter_id = ?').run(candidateId)
    db.prepare('UPDATE invitations SET accepted_by = NULL WHERE accepted_by = ?').run(candidateId)
    if (email) db.prepare('DELETE FROM login_codes WHERE email = ?').run(email)
    // The account first: what is append-only while it exists can then go.
    db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId)
    for (const table of candidateTables()) db.prepare(`DELETE FROM ${table} WHERE candidate_id = ?`).run(candidateId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  // Their files, once the rows that point at them are gone.
  const uploads = path.join(DATA_DIRECTORY, 'uploads')
  for (const id of sources) {
    for (const file of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
      if (file.startsWith(`${id}.`)) fs.rmSync(path.join(uploads, file), { force: true })
    }
  }
  for (const folder of ['files', 'applications']) fs.rmSync(path.join(DATA_DIRECTORY, folder, candidateId), { recursive: true, force: true })
}

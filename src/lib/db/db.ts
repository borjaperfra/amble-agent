import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

const DATA_DIR = path.join(process.cwd(), '.amble-data')
const DB_PATH = path.join(DATA_DIR, 'amble.db')

declare global {
  var __ambleDb: DatabaseSync | undefined
}

function createDb(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT,
      descriptor TEXT,
      descriptor_grounded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      uri TEXT,
      original_filename TEXT,
      mime_type TEXT,
      stored_path TEXT,
      char_count INTEGER,
      status TEXT NOT NULL,
      status_detail TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      source_id TEXT REFERENCES sources(id),
      interview_turn_id TEXT,
      statement TEXT NOT NULL,
      claim_type TEXT NOT NULL,
      epistemic_state TEXT NOT NULL,
      source_excerpt TEXT,
      source_location TEXT,
      confidence REAL,
      requires_confirmation INTEGER NOT NULL DEFAULT 0,
      possible_capabilities TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      claim_id TEXT REFERENCES claims(id),
      statement TEXT NOT NULL,
      epistemic_state TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_excerpt TEXT,
      strength TEXT NOT NULL,
      confidence REAL,
      corroborated_by TEXT NOT NULL DEFAULT '[]',
      contradicted_by TEXT NOT NULL DEFAULT '[]',
      candidate_confirmed INTEGER NOT NULL DEFAULT 0,
      human_verified INTEGER NOT NULL DEFAULT 0,
      interview_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT NOT NULL,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      name TEXT NOT NULL,
      assessment TEXT NOT NULL,
      reason TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, candidate_id)
    );

    CREATE TABLE IF NOT EXISTS capability_evidence (
      capability_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      PRIMARY KEY (capability_id, evidence_id)
    );

    CREATE TABLE IF NOT EXISTS uncertainties (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      capability_id TEXT,
      description TEXT NOT NULL,
      reason TEXT,
      materiality TEXT NOT NULL,
      status TEXT NOT NULL,
      resolvable_by_interview INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by_turn TEXT
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS interview_turns (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id),
      idx INTEGER NOT NULL,
      question TEXT,
      question_reason TEXT,
      target_capability_ids TEXT NOT NULL DEFAULT '[]',
      target_uncertainty_ids TEXT NOT NULL DEFAULT '[]',
      answer TEXT,
      created_at TEXT NOT NULL,
      answered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS model_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      task TEXT NOT NULL,
      task_version TEXT NOT NULL,
      provider TEXT,
      model_id TEXT,
      base_url TEXT,
      prompt_chars INTEGER,
      output_chars INTEGER,
      latency_ms INTEGER,
      ok INTEGER NOT NULL,
      error TEXT,
      raw_output TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS distinctive_profiles (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      capability_ids TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intent_profiles (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      raw_answer TEXT NOT NULL,
      groups TEXT NOT NULL,
      listening_for TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      valid_until TEXT
    );
  `)
  return db
}

export function getDb(): DatabaseSync {
  if (!globalThis.__ambleDb) {
    globalThis.__ambleDb = createDb()
  }
  return globalThis.__ambleDb
}

export const DATA_DIRECTORY = DATA_DIR

type DeferredWrite = () => void
let transactionDepth = 0
const deferredWrites: DeferredWrite[] = []

export function queueWrite(write: DeferredWrite): void {
  if (transactionDepth > 0) {
    deferredWrites.push(write)
  } else {
    write()
  }
}

export function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = getDb()
  const isOutermost = transactionDepth === 0
  if (isOutermost) db.exec('BEGIN')
  transactionDepth++
  return fn().then(
    (result) => {
      transactionDepth--
      if (isOutermost) {
        db.exec('COMMIT')
        flushDeferredWrites()
      }
      return result
    },
    (error) => {
      transactionDepth--
      if (isOutermost) {
        db.exec('ROLLBACK')
        flushDeferredWrites()
      }
      throw error
    },
  )
}

function flushDeferredWrites(): void {
  const writes = deferredWrites.splice(0, deferredWrites.length)
  for (const write of writes) {
    try {
      write()
    } catch {
      // Audit writes must never break the flow that produced them.
    }
  }
}

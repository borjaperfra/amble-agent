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
      reasoning_output TEXT,
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

    -- What would actually make an opportunity worth a look, in terms that can
    -- be checked against a real one. The free-text intent says "good economic
    -- offer"; this says 65000 EUR, and only one of those can be matched.
    CREATE TABLE IF NOT EXISTS preferences (
      candidate_id TEXT PRIMARY KEY REFERENCES candidates(id),
      salary_min INTEGER,
      salary_currency TEXT,
      work_mode TEXT,
      location TEXT,
      technologies TEXT NOT NULL DEFAULT '[]',
      stages TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      notify_channel TEXT,
      notify_email TEXT,
      notify_whatsapp TEXT,
      notify_telegram TEXT,
      updated_at TEXT NOT NULL
    );

    -- Background work, on disk rather than in memory: a phone on a train
    -- loses the connection for minutes at a time, and work that only exists
    -- inside a running process dies with the request that started it.
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      run_after TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS jobs_ready ON jobs (status, run_after);

    -- ─── Opportunity Zero ────────────────────────────────────────────────
    -- An opportunity arrives as raw text and leaves as one of three answers.
    -- Every step in between is its own row, so the trail from what arrived to
    -- what the candidate was told can be walked backwards.

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      url TEXT,
      raw_text TEXT NOT NULL,
      provenance TEXT NOT NULL,
      fixture_key TEXT,
      -- How the feed it came from names it, so a sync that runs every day
      -- brings the same offer back without ingesting it twice.
      source_ref TEXT,
      status TEXT NOT NULL,
      status_detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS opportunity_rubrics (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      version TEXT NOT NULL,
      rubric TEXT NOT NULL,
      model_run_id TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS opportunity_assessments (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      rubric_id TEXT NOT NULL REFERENCES opportunity_rubrics(id),
      version TEXT NOT NULL,
      hard_constraints TEXT NOT NULL,
      evidence_match TEXT NOT NULL,
      intent_match TEXT NOT NULL,
      unknowns TEXT NOT NULL,
      intent_references TEXT NOT NULL DEFAULT '[]',
      model_run_id TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL
    );

    -- model_decision is what the model proposed; decision is what the domain
    -- rules settled on. Keeping both is the only way to find out whether the
    -- model can be trusted with this later, or whether the rules are wrong.
    CREATE TABLE IF NOT EXISTS opportunity_decisions (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      assessment_id TEXT NOT NULL REFERENCES opportunity_assessments(id),
      version TEXT NOT NULL,
      model_decision TEXT,
      decision TEXT NOT NULL,
      override_reason TEXT,
      reason TEXT NOT NULL,
      supporting_evidence_ids TEXT NOT NULL DEFAULT '[]',
      supporting_intent_refs TEXT NOT NULL DEFAULT '[]',
      material_unknowns TEXT NOT NULL DEFAULT '[]',
      next_action_type TEXT NOT NULL,
      next_action_question TEXT,
      explanation TEXT,
      unsupported_claims TEXT NOT NULL DEFAULT '[]',
      model_run_id TEXT,
      explanation_model_run_id TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL
    );

    -- A table of its own, deliberately. The blind human label is written
    -- before Amble runs and must never travel with the row the pipeline
    -- reads; keeping it apart makes that structural rather than a promise.
    CREATE TABLE IF NOT EXISTS opportunity_labels (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      label TEXT NOT NULL,
      comment TEXT,
      origin TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS opportunity_responses (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      decision_id TEXT NOT NULL REFERENCES opportunity_decisions(id),
      response TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Append-only. Nothing in the codebase updates or deletes a row here.
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT,
      model_run_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_by_subject ON audit_events (subject_type, subject_id);

    -- The one message, on its way out.
    --
    -- Written before anything is sent and kept afterwards, so "we told you"
    -- is a row rather than a belief. The unique index is the point: a job
    -- that retries after a dropped connection must not send a second copy of
    -- the same interruption, and the database is a better place to promise
    -- that than the code that happens to call it.
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      channel TEXT NOT NULL,
      address TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      about_type TEXT NOT NULL,
      about_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS notifications_once
      ON notifications (about_type, about_id, channel);
    CREATE INDEX IF NOT EXISTS notifications_by_candidate
      ON notifications (candidate_id, created_at);

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
  migrate(db)
  return db
}

/**
 * Additive migrations for databases created before a column existed.
 * CREATE TABLE IF NOT EXISTS leaves an older table untouched, so anything
 * added after the first run has to be patched in here.
 */
function migrate(db: DatabaseSync): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).some(
      (row) => row.name === column,
    )

  if (!has('model_runs', 'reasoning_output')) {
    db.exec('ALTER TABLE model_runs ADD COLUMN reasoning_output TEXT;')
  }
  if (!has('preferences', 'notify_telegram')) {
    db.exec('ALTER TABLE preferences ADD COLUMN notify_telegram TEXT;')
  }
  if (!has('opportunities', 'source_ref')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN source_ref TEXT;')
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS opportunities_by_source ON opportunities (candidate_id, source_ref);',
  )
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

/**
 * Careful: this counts depth in a module-level variable, which assumes one
 * writer at a time. The job queue now runs two lanes at once, so anything
 * wrapped in here could swallow a write made by the other lane, or lose it on
 * a rollback. Nothing calls it today. Before something does, it needs to hold
 * the lanes apart — or the lanes need to stop overlapping.
 */
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

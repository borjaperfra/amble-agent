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

    -- PRODUCT_SPEC §12.1 and §19: a retraction records the evidence, the defence
    -- question that defeated it and the answer that defeated it. Append-only.
    CREATE TABLE IF NOT EXISTS retractions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      evidence_id TEXT NOT NULL REFERENCES evidence(id),
      statement TEXT NOT NULL,
      question TEXT,
      answer TEXT,
      reason TEXT NOT NULL,
      turn_id TEXT,
      previous_state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Generated career.md, versioned per candidate. Synthesis is a model call, so
    -- a version is a record of what the system said at a point in time, not a
    -- cache: it is kept so changes after a defence or retraction can be compared.
    CREATE TABLE IF NOT EXISTS career_documents (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      version INTEGER NOT NULL,
      markdown TEXT NOT NULL,
      stats TEXT NOT NULL,
      model_run_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (candidate_id, version)
    );

    -- Revealed intent (PRODUCT_SPEC §15.1). A triage is a set of offers that each
    -- cross two or more declared conditions, forcing a trade-off. The axes an
    -- offer tests are stored but never shown to the candidate before answering.
    CREATE TABLE IF NOT EXISTS offer_triages (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      method TEXT,
      -- What the candidate had declared when the triage was built. Revealed
      -- preferences are measured against this, not against a later intent.
      declared TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      analysed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS offer_probes (
      id TEXT PRIMARY KEY,
      triage_id TEXT NOT NULL REFERENCES offer_triages(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      salary_eur INTEGER,
      attributes TEXT NOT NULL DEFAULT '{}',
      axes TEXT NOT NULL DEFAULT '[]',
      is_status_quo INTEGER NOT NULL DEFAULT 0,
      verdict TEXT,
      conditions TEXT,
      reason TEXT,
      answered_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (triage_id, idx)
    );

    CREATE TABLE IF NOT EXISTS revealed_preferences (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      triage_id TEXT NOT NULL REFERENCES offer_triages(id),
      kind TEXT NOT NULL,
      statement TEXT NOT NULL,
      declared TEXT,
      evidence_probe_ids TEXT NOT NULL,
      quote TEXT,
      status TEXT NOT NULL,
      model_run_id TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    -- Sourcing. Companies the Rep watches, and how their offers are read.
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL UNIQUE,
      domain TEXT,
      careers_url TEXT,
      ats TEXT,
      ats_token TEXT,
      status TEXT NOT NULL,
      discovered_via TEXT NOT NULL,
      last_fetched_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      title TEXT NOT NULL,
      title_norm TEXT NOT NULL,
      location TEXT,
      workplace TEXT,
      url TEXT,
      url_norm TEXT,
      description TEXT,
      salary_min INTEGER,
      salary_max INTEGER,
      salary_currency TEXT,
      salary_raw TEXT,
      posted_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS opportunities_company ON opportunities(company_id);
    CREATE INDEX IF NOT EXISTS opportunities_url ON opportunities(url_norm);

    -- One offer can reach the Rep from several sources (the company's ATS and an
    -- aggregator). Each sighting is kept, so closure is decided per source.
    CREATE TABLE IF NOT EXISTS opportunity_sources (
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      url TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      closed_at TEXT,
      PRIMARY KEY (source, external_id)
    );

    CREATE TABLE IF NOT EXISTS sourcing_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      stats TEXT,
      errors TEXT
    );

    CREATE TRIGGER IF NOT EXISTS retractions_no_update BEFORE UPDATE ON retractions
    BEGIN SELECT RAISE(ABORT, 'retractions are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS retractions_no_delete BEFORE DELETE ON retractions
    BEGIN SELECT RAISE(ABORT, 'retractions are append-only'); END;
  `)
  migrate(db)
  return db
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
  return columns.some((row) => row.name === column)
}

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): boolean {
  if (hasColumn(db, table, column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

function migrate(db: DatabaseSync): void {
  // Attribution (PRODUCT_SPEC §11.1, §12).
  const attributionAdded = addColumn(db, 'evidence', 'attribution', "TEXT NOT NULL DEFAULT 'sole'")
  addColumn(db, 'evidence', 'attribution_tool', 'TEXT')
  addColumn(db, 'evidence', 'defence_status', 'TEXT')
  addColumn(db, 'evidence', 'defence_turn_id', 'TEXT')
  addColumn(db, 'evidence', 'retracted_at', 'TEXT')
  addColumn(db, 'evidence', 'retracted_reason', 'TEXT')
  addColumn(db, 'evidence', 'retracted_by_turn', 'TEXT')

  if (attributionAdded) {
    // Evidence read from repositories before attribution existed was stored as if
    // the candidate alone had written it. Re-read it as what it is: co-produced,
    // and undefended. What the artifact shows (SOURCE_FACT) stands; what it was
    // taken to say about the person's judgment (USER_CLAIM) does not, yet.
    db.exec(`
      UPDATE evidence SET
        attribution = 'assisted',
        defence_status = CASE WHEN epistemic_state = 'USER_CLAIM' THEN 'undefended' ELSE NULL END,
        strength = CASE WHEN epistemic_state = 'USER_CLAIM' THEN 'limited' ELSE strength END,
        candidate_confirmed = CASE WHEN epistemic_state = 'USER_CLAIM' THEN 0 ELSE candidate_confirmed END,
        epistemic_state = CASE WHEN epistemic_state = 'USER_CLAIM' THEN 'ASSISTED_CLAIM' ELSE epistemic_state END
      WHERE source_type = 'github'
    `)
  }

  // Defence questions (§10.2) are interview turns aimed at evidence, not gaps.
  addColumn(db, 'interview_turns', 'kind', "TEXT NOT NULL DEFAULT 'gap'")
  addColumn(db, 'interview_turns', 'target_evidence_ids', "TEXT NOT NULL DEFAULT '[]'")

  // Two kinds of uncertainty (§14.1): MATERIALITY and ATTRIBUTION.
  addColumn(db, 'uncertainties', 'kind', "TEXT NOT NULL DEFAULT 'MATERIALITY'")

  // A short form of a revealed preference, for what the Rep listens for.
  addColumn(db, 'revealed_preferences', 'label', 'TEXT')
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

import { DatabaseSync, type StatementSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

// Where everything the product keeps lives: the database and the files people
// give it. On a server, a persistent volume (AMBLE_DATA_DIR).
const DATA_DIR = process.env.AMBLE_DATA_DIR ?? path.join(process.cwd(), '.amble-data')
const DB_PATH = path.join(DATA_DIR, 'amble.db')

declare global {
  var __ambleDb: DatabaseSync | undefined
}

// What a pass reads of each open offer (listOpenOpportunities), held by the
// index opportunities_open, newest first.
export const OPEN_OPPORTUNITY_COLUMNS = [
  'first_seen_at',
  'id',
  'company_id',
  'title',
  'title_norm',
  'location',
  'workplace',
  'salary_min',
  'salary_max',
  'salary_currency',
  'salary_raw',
  'posted_at',
] as const

function createDb(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  // With WAL, NORMAL never corrupts the file: a commit is on disk at the next
  // checkpoint, so a power cut (not a crash of the process) can lose the last
  // few. FULL syncs every commit, a millisecond or more each on a volume.
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  // The other process may hold the write lock for a moment: wait for it
  // rather than fail.
  db.exec('PRAGMA busy_timeout = 5000;')
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

    -- A rule they stated in conversation (WhatsApp) has no triage behind it.
    CREATE TABLE IF NOT EXISTS revealed_preferences (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      triage_id TEXT REFERENCES offer_triages(id),
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

    -- Matching. A role query turns the candidate's profile into a free,
    -- deterministic prefilter; it is regenerated only when the profile changes
    -- (profile_hash).
    CREATE TABLE IF NOT EXISTS role_queries (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      profile_hash TEXT NOT NULL,
      query TEXT NOT NULL,
      model_run_id TEXT,
      created_at TEXT NOT NULL
    );

    -- One assessment per offer per profile: when what the candidate wants
    -- changes, offers are judged again against the new profile.
    CREATE TABLE IF NOT EXISTS opportunity_matches (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      profile_hash TEXT NOT NULL,
      verdict TEXT NOT NULL,
      gates TEXT NOT NULL,
      explanation TEXT NOT NULL,
      dropped TEXT NOT NULL DEFAULT '[]',
      model_run_id TEXT,
      created_at TEXT NOT NULL,
      response TEXT,
      response_reason TEXT,
      responded_at TEXT,
      UNIQUE (opportunity_id, profile_hash)
    );

    -- Signing in: a one-time code sent by email, then a session. Neither the
    -- code nor the session token is stored, only their hashes.
    CREATE TABLE IF NOT EXISTS login_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS login_codes_email ON login_codes (email, created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_candidate ON sessions (candidate_id);

    -- The beta is by invitation: a link that creates one account. Each member
    -- has a few to give; the owner issues as many as needed. The token is kept
    -- so a member can see and copy their links again.
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      inviter_id TEXT REFERENCES candidates(id),
      created_at TEXT NOT NULL,
      accepted_by TEXT REFERENCES candidates(id),
      accepted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS invitations_inviter ON invitations (inviter_id);

    -- What the candidate decided about an offer, and how far they took it. It
    -- belongs to the offer, not to an assessment: judging offers again (a new
    -- profile, a new matcher) must never lose that they applied, nor bring back
    -- one they said no to.
    CREATE TABLE IF NOT EXISTS opportunity_decisions (
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      decision TEXT NOT NULL,
      reason TEXT,
      decided_at TEXT NOT NULL,
      progress TEXT,
      progress_at TEXT,
      PRIMARY KEY (candidate_id, opportunity_id)
    );

    -- What beta users tell us, from the app or from WhatsApp.
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      channel TEXT NOT NULL,
      page TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT
    );

    -- What the candidate answered themselves in application forms, kept for
    -- the next form that asks the same; and the CV they send, as a file.
    CREATE TABLE IF NOT EXISTS candidate_answers (
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      question_key TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (candidate_id, question_key)
    );

    -- WhatsApp (whatsapp/): the number a person linked by writing to amble
    -- first, the codes that link it, the provider's events already handled,
    -- and the questions asked about applications they sent.
    CREATE TABLE IF NOT EXISTS whatsapp_links (
      candidate_id TEXT PRIMARY KEY REFERENCES candidates(id),
      phone TEXT NOT NULL,
      user_id TEXT,
      conversation_id TEXT,
      linked_at TEXT NOT NULL,
      last_inbound_at TEXT
    );

    -- The conversation itself, both ways: what the agent reads before it
    -- answers, and part of what a person takes with their data.
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      direction TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS whatsapp_messages_by_candidate ON whatsapp_messages (candidate_id, created_at);

    -- Links sent on WhatsApp that open the person's own account (applinks.ts).
    CREATE TABLE IF NOT EXISTS app_links (
      token_hash TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      route TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- Messages the agent left itself for a later day (reminders.ts).
    CREATE TABLE IF NOT EXISTS whatsapp_reminders (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      due_on TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    -- Searches in aggregators (TheirStack, InfoJobs), each for one person's
    -- query, taken in turns (matching/run.ts).
    CREATE TABLE IF NOT EXISTS source_searches (
      source TEXT NOT NULL,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      searched_at TEXT NOT NULL,
      credits INTEGER NOT NULL
    );

    -- Interview questions asked on WhatsApp (whatsapp/interview.ts).
    CREATE TABLE IF NOT EXISTS whatsapp_questions (
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      turn_id TEXT NOT NULL,
      asked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
      code TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_events (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    -- Offers sent on WhatsApp: each one read a second time before it goes,
    -- whether it went, and what they answered.
    CREATE TABLE IF NOT EXISTS offer_sends (
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      match_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      model_run_id TEXT,
      sent_at TEXT,
      answer TEXT,
      answered_at TEXT,
      PRIMARY KEY (candidate_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS application_followups (
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      opportunity_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      asked_at TEXT NOT NULL,
      answer TEXT,
      answered_at TEXT,
      PRIMARY KEY (candidate_id, opportunity_id, round)
    );

    CREATE TABLE IF NOT EXISTS application_files (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- What the Rep prepared to apply to an offer: advice, a message and the
    -- form's answers. Kept, so opening it again costs nothing.
    CREATE TABLE IF NOT EXISTS application_drafts (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      content TEXT NOT NULL,
      model_run_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (candidate_id, opportunity_id)
    );

    CREATE TRIGGER IF NOT EXISTS retractions_no_update BEFORE UPDATE ON retractions
    BEGIN SELECT RAISE(ABORT, 'retractions are append-only'); END;

    -- Append-only while the account exists; when the person deletes their
    -- account (account.ts), the record of what they withdrew goes with it.
    DROP TRIGGER IF EXISTS retractions_no_delete;
    CREATE TRIGGER retractions_no_delete BEFORE DELETE ON retractions
    WHEN EXISTS (SELECT 1 FROM candidates WHERE id = OLD.candidate_id)
    BEGIN SELECT RAISE(ABORT, 'retractions are append-only'); END;
  `)
  migrate(db)
  // What the query planner knows of each table, refreshed where missing or
  // stale (SQLite's advice for a connection that stays open; retention.ts
  // refreshes it every pass). Without it, closing a board's missing offers
  // reads every sighting of that board's kind.
  db.exec('PRAGMA optimize = 0x10002;')
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

// A table rebuilt from its own definition with one change to it: SQLite
// cannot drop a NOT NULL in place. Its rows, columns added since and the
// order of those columns all carry over; its indexes are made again below.
function rebuildTable(db: DatabaseSync, table: string, from: string, to: string): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined
  if (!row || !row.sql.includes(from)) return
  const definition = row.sql.replace(from, to).replace(/^CREATE TABLE\s+(?:"?\w+"?)/i, `CREATE TABLE ${table}_rebuilt`)
  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec('BEGIN')
    try {
      db.exec(definition)
      db.exec(`INSERT INTO ${table}_rebuilt SELECT * FROM ${table}`)
      db.exec(`DROP TABLE ${table}`)
      db.exec(`ALTER TABLE ${table}_rebuilt RENAME TO ${table}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;')
  }
}

function migrate(db: DatabaseSync): void {
  // A rule they state on WhatsApp is theirs without a triage behind it.
  rebuildTable(db, 'revealed_preferences', 'triage_id TEXT NOT NULL REFERENCES', 'triage_id TEXT REFERENCES')

  // Which voice and language what the person reads on their profile was
  // written in (a capability's name and reason, an uncertainty's description):
  // rows from before are rewritten once (src/lib/career/explanations.ts).
  addColumn(db, 'capabilities', 'written_for', 'TEXT')
  addColumn(db, 'uncertainties', 'written_for', 'TEXT')

  // What the agent waits for on WhatsApp next (why an offer does not fit, a
  // yes to a change): one thing at a time, as JSON.
  addColumn(db, 'whatsapp_links', 'awaiting', 'TEXT')
  // The offer's message as the second reading wrote it for them.
  addColumn(db, 'offer_sends', 'pitch', 'TEXT')

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

  // The candidate's language: what the interface and everything the Rep writes
  // use. 'chosen' by the candidate always wins over 'detected' from their words.
  addColumn(db, 'candidates', 'locale', 'TEXT')
  addColumn(db, 'candidates', 'locale_source', 'TEXT')

  // The candidate can correct a preference or add one (PRODUCT_SPEC §18). What
  // the analysis proposed is kept, so the correction stays visible.
  addColumn(db, 'revealed_preferences', 'origin', "TEXT NOT NULL DEFAULT 'analysis'")
  addColumn(db, 'revealed_preferences', 'original_statement', 'TEXT')
  addColumn(db, 'revealed_preferences', 'original_label', 'TEXT')
  addColumn(db, 'revealed_preferences', 'revised_at', 'TEXT')

  // A rule as the person reads it (the rule itself, plainly), and apart from
  // it why amble believes it (which sample offers, what they answered).
  // `statement` is what the matcher reads, and it is in the fingerprint of
  // their assessments: rules written before stated how they were learned, and
  // their plain wording goes here (scripts/rewrite-rules.ts) so that the
  // matcher's input, and every assessment, stays as it is. NULL: not yet
  // reworded, shown as the statement.
  addColumn(db, 'revealed_preferences', 'wording', 'TEXT')
  addColumn(db, 'revealed_preferences', 'evidence', 'TEXT')

  // The directory (src/lib/sourcing/directory.ts): whether a company is built in
  // Spain or hires people there from elsewhere, and whether its offers carry a
  // salary.
  addColumn(db, 'companies', 'segment', 'TEXT')
  addColumn(db, 'companies', 'public_salary', 'INTEGER NOT NULL DEFAULT 0')

  // What an offer that publishes no salary probably pays, from the reference
  // table (src/lib/salary/): computed once, as JSON with the table's version.
  // Its own table: a column after the description would make reading it read
  // every description. Goes with the offer when the offer is deleted.
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_salary_estimates (
      opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
      estimate TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  // What an offer states about itself (matching/facts.ts): way of working,
  // where remote work may be done from, offices, required languages, salary,
  // a minimum level; each with the words that say it. Read once for everyone,
  // read again only when the offer's text or the reader's version changes.
  // Goes with the offer when the offer is deleted.
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_facts (
      opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
      facts_version TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      facts TEXT NOT NULL,
      model_run_id TEXT,
      created_at TEXT NOT NULL
    );
  `)

  // Accounts: the email a candidate signs in with, and whether they own the
  // installation (the sourcing tools and the trace are theirs alone).
  addColumn(db, 'candidates', 'email', 'TEXT')
  addColumn(db, 'candidates', 'role', "TEXT NOT NULL DEFAULT 'member'")
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS candidates_email ON candidates (email) WHERE email IS NOT NULL')

  // A code asked for from an invitation creates the account when it is used.
  addColumn(db, 'login_codes', 'invitation_id', 'TEXT')

  // The same sign-in, by one click from the email: the hash of the link's token.
  addColumn(db, 'login_codes', 'link_hash', 'TEXT')

  // When the candidate told the Rep their name and language, the first time in.
  addColumn(db, 'candidates', 'setup_at', 'TEXT')

  // The candidate paused the search until further notice: nothing is read for
  // them and nothing is written to them first, until they resume it.
  addColumn(db, 'candidates', 'search_paused_at', 'TEXT')
  // A pause for a while: the day to ask them whether to start again.
  addColumn(db, 'candidates', 'pause_check_on', 'TEXT')

  // A source that carried wording meant for a machine (hidden text, or
  // instructions for a screening system): read without it, never sent on.
  addColumn(db, 'sources', 'flag', 'TEXT')

  // Each time a person gave amble something to read (a file, a link, a CV to
  // send), accepted or not: what the daily limits count (src/lib/limits.ts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS intake_events (
      candidate_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS intake_events_by_candidate ON intake_events (candidate_id, kind, created_at);
  `)

  // The last read for each person, in numbers (offers open, those of their
  // role, judged, waiting): what "why nothing yet" is explained from.
  db.exec(`
    CREATE TABLE IF NOT EXISTS matching_stats (
      candidate_id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      stats TEXT NOT NULL
    );
  `)

  // An assessment carried over to a new profile without a model call: the
  // key it was copied from and why it still holds (src/lib/matching/carry.ts).
  addColumn(db, 'opportunity_matches', 'carried_from', 'TEXT')
  addColumn(db, 'opportunity_matches', 'carried_reason', 'TEXT')
  // What each profile an assessment belongs to was, rules and query as the
  // assessor used them: what a change of rules is compared with.
  db.exec(`
    CREATE TABLE IF NOT EXISTS matching_snapshots (
      candidate_id TEXT NOT NULL,
      match_key TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (candidate_id, match_key)
    );
  `)
  // What the provider counted for each call: tokens in, of them read from its
  // prompt cache, tokens out and of them reasoning. Null when it says nothing.
  addColumn(db, 'model_runs', 'prompt_tokens', 'INTEGER')
  addColumn(db, 'model_runs', 'cached_tokens', 'INTEGER')
  addColumn(db, 'model_runs', 'completion_tokens', 'INTEGER')
  addColumn(db, 'model_runs', 'reasoning_tokens', 'INTEGER')

  // What filling forms has taught, for everyone: per ATS and kind of field,
  // how often each way of filling it held (src/lib/apply/reflect.ts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS form_lessons (
      ats TEXT NOT NULL,
      kind TEXT NOT NULL,
      strategy TEXT NOT NULL,
      worked INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ats, kind, strategy)
    );
  `)

  // Lookups every pass and every screen makes, which otherwise read whole
  // tables: an offer's sightings, a person's assessments for their current
  // profile, the postings judged in one model run, a person's model runs.
  db.exec(`
    CREATE INDEX IF NOT EXISTS opportunity_sources_by_opportunity ON opportunity_sources (opportunity_id, source);
    CREATE INDEX IF NOT EXISTS opportunity_matches_by_key ON opportunity_matches (candidate_id, profile_hash, created_at);
    CREATE INDEX IF NOT EXISTS opportunity_matches_by_run ON opportunity_matches (model_run_id) WHERE model_run_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS model_runs_by_candidate ON model_runs (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS model_runs_by_created ON model_runs (created_at);
    CREATE INDEX IF NOT EXISTS whatsapp_events_by_time ON whatsapp_events (received_at);
  `)

  // A person's profile, read on every screen and every pass: by person, so
  // what one reads never grows with how many people there are.
  db.exec(`
    CREATE INDEX IF NOT EXISTS sources_by_candidate ON sources (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS claims_by_candidate ON claims (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS evidence_by_candidate ON evidence (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS capabilities_by_candidate ON capabilities (candidate_id);
    CREATE INDEX IF NOT EXISTS capability_evidence_by_candidate ON capability_evidence (candidate_id, capability_id);
    CREATE INDEX IF NOT EXISTS uncertainties_by_candidate ON uncertainties (candidate_id, status);
    CREATE INDEX IF NOT EXISTS interviews_by_candidate ON interviews (candidate_id, status);
    CREATE INDEX IF NOT EXISTS interview_turns_by_interview ON interview_turns (interview_id, idx);
    CREATE INDEX IF NOT EXISTS intent_profiles_by_candidate ON intent_profiles (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS offer_triages_by_candidate ON offer_triages (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS revealed_preferences_by_candidate ON revealed_preferences (candidate_id, status);
    CREATE INDEX IF NOT EXISTS revealed_preferences_by_triage ON revealed_preferences (triage_id);
    CREATE INDEX IF NOT EXISTS role_queries_by_profile ON role_queries (candidate_id, profile_hash, created_at);
  `)

  // An offer's description is nearly all of the table and sits before the
  // columns a pass reads, so reading those means reading every description.
  // Open offers are listed from this index alone (listOpenOpportunities);
  // closed ones are found by when they closed (retention.ts).
  db.exec(`
    CREATE INDEX IF NOT EXISTS opportunities_open ON opportunities (${OPEN_OPPORTUNITY_COLUMNS.join(', ')}, closed_at) WHERE closed_at IS NULL;
    CREATE INDEX IF NOT EXISTS opportunities_closed ON opportunities (closed_at) WHERE closed_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS opportunities_open_seen ON opportunities (last_seen_at) WHERE closed_at IS NULL;
  `)

  // Answers given before decisions had their own table lived on assessments.
  // Carried over once, the latest per offer; a later decision is never replaced.
  db.exec(`
    INSERT OR IGNORE INTO opportunity_decisions (candidate_id, opportunity_id, decision, reason, decided_at)
    SELECT candidate_id, opportunity_id, response, response_reason, COALESCE(responded_at, created_at)
    FROM opportunity_matches WHERE response IS NOT NULL
    ORDER BY COALESCE(responded_at, created_at) DESC
  `)
}

export function getDb(): DatabaseSync {
  if (!globalThis.__ambleDb) {
    globalThis.__ambleDb = createDb()
  }
  return globalThis.__ambleDb
}

export const DATA_DIRECTORY = DATA_DIR

declare global {
  var __ambleStatements: Map<string, StatementSync> | undefined
}

// A statement prepared once and reused, for what runs thousands of times a
// pass (a sighting, an assessment). Preparing costs more than running most
// of them.
export function prepared(sql: string): StatementSync {
  const statements = (globalThis.__ambleStatements ??= new Map())
  let statement = statements.get(sql)
  if (!statement) {
    statement = getDb().prepare(sql)
    statements.set(sql, statement)
  }
  return statement
}

// A transaction is synchronous: nothing is awaited inside it, so no other
// request's writes can land in the middle, and the write lock is held for
// milliseconds, never across a model call (the web server and the scheduled
// pass are two processes sharing this file).
export function inTransaction<T>(fn: () => T): T {
  const db = getDb()
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    // Some errors (a full disk) have already rolled the transaction back.
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

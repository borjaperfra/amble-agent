import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Donde vive todo: la base y los ficheros que subió.
 *
 * Por defecto, al lado del proyecto — que es lo que hace que un test se lleve
 * su propio directorio con un `chdir` y que borrar `.amble-data/` sea empezar
 * de cero. En un servidor el disco que sobrevive a un despliegue está montado
 * en otra parte, y eso es lo único que `AMBLE_DATA_DIR` cambia: sin él, nada
 * de esto se mueve.
 */
const DATA_DIR = process.env.AMBLE_DATA_DIR?.trim()
  ? path.resolve(process.env.AMBLE_DATA_DIR.trim())
  : path.join(process.cwd(), '.amble-data')
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

    -- A question the Rep needs answered before it can decide.
    --
    -- Its own table rather than an interview turn: the interview is a flow
    -- with a beginning and an end, and this is one thing asked about one
    -- opportunity, months later, possibly while nothing else is happening.
    -- The answer lands in the graph by the same path either way.
    CREATE TABLE IF NOT EXISTS opportunity_questions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      decision_id TEXT REFERENCES opportunity_decisions(id),
      unknown_id TEXT,
      question TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      answer TEXT,
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      answered_at TEXT
    );

    -- Asked once. A re-evaluation that reaches the same gap must not ask
    -- again, and somebody who answered must never see it a second time.
    CREATE UNIQUE INDEX IF NOT EXISTS opportunity_questions_once
      ON opportunity_questions (opportunity_id, question);
    CREATE INDEX IF NOT EXISTS opportunity_questions_open
      ON opportunity_questions (candidate_id, status);

    CREATE UNIQUE INDEX IF NOT EXISTS notifications_once
      ON notifications (about_type, about_id, channel);
    CREATE INDEX IF NOT EXISTS notifications_by_candidate
      ON notifications (candidate_id, created_at);

    -- What came back the other way.
    --
    -- A message the candidate sent to the bot, written down before anything
    -- is done about it. Telegram hands the same update over again until an
    -- offset confirms it, and a confirmation lost to a restart must not turn
    -- one answer into two answers: the unique index is where that is
    -- promised, rather than in whichever loop happens to be polling.
    --
    -- It also keeps what was said. A message that arrives while nothing is
    -- open, or from a chat that is not theirs, is still a thing somebody
    -- typed, and throwing it away would leave no way to find out why their
    -- reply seemed to go nowhere.
    CREATE TABLE IF NOT EXISTS inbound_messages (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      sender TEXT,
      text TEXT NOT NULL,
      outcome TEXT NOT NULL,
      about_type TEXT,
      about_id TEXT,
      detail TEXT,
      incorporated_at TEXT,
      answer TEXT,
      -- Lo que sostiene cada cosa dicha en esa respuesta, ya comprobado.
      -- Guardado y no recalculado: una fuente que se recalcula manana con un
      -- grafo distinto ya no es la fuente de lo que se dijo ayer.
      answer_sources TEXT,
      -- Por donde va, mientras va. Leer una oferta y compararla con una
      -- carrera entera son noventa segundos, y noventa segundos de «cargando»
      -- es una pantalla rota; noventa segundos de «estoy leyendo la oferta»
      -- es alguien trabajando.
      progress TEXT,
      answered_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS inbound_messages_once
      ON inbound_messages (channel, external_id);
    CREATE INDEX IF NOT EXISTS inbound_messages_by_candidate
      ON inbound_messages (candidate_id, created_at);

    -- ─── Los dos agentes ────────────────────────────────────────────────
    -- La oferta desde el lado de la empresa.
    --
    -- Separada de "opportunities" a proposito, y no por normalizar: es la
    -- costura por donde esto se parte en dos despliegues. "opportunities" es
    -- el anuncio tal y como lo lee el Rep; esto es lo que la empresa sabe y
    -- no ha publicado — su techo real, hasta donde cede, quien manda. El dia
    -- que el agente de la empresa viva en otra maquina, esta tabla se va con
    -- el y la otra se queda.
    CREATE TABLE IF NOT EXISTS openings (
      id TEXT PRIMARY KEY,
      employer TEXT NOT NULL,
      role TEXT NOT NULL,
      -- Lo publicado, para poder comparar con lo que de verdad hay detras.
      posting_text TEXT NOT NULL,
      -- Lo que la empresa contesta si se lo preguntan, en JSON: pregunta que
      -- reconoce y respuesta. Lo que no este aqui, su agente no lo sabe — y
      -- entonces hay que preguntarle a un humano, que es la decision 2.
      answers TEXT NOT NULL DEFAULT '{}',
      -- Sus propias condiciones duras, las que deciden si para o sigue.
      budget_max INTEGER,
      currency TEXT,
      work_model TEXT,
      location TEXT,
      created_at TEXT NOT NULL
    );

    -- Una conversacion entre el Rep de alguien y una oferta.
    --
    -- "disclosure_tier" es la escalera del 19 y vive aqui, no en el prompt:
    -- mientras sea "guarded" su nombre no sale, y quien lo sube es el, nadie
    -- mas.
    CREATE TABLE IF NOT EXISTS negotiations (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      opening_id TEXT NOT NULL REFERENCES openings(id),
      -- Como la lee el Rep: de ahi salen las preguntas de los dos lados.
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      state TEXT NOT NULL DEFAULT 'open',
      disclosure_tier TEXT NOT NULL DEFAULT 'guarded',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS negotiations_once
      ON negotiations (candidate_id, opening_id);

    -- Lo que se dijeron, en orden y con lo que lo sostiene.
    --
    -- "kind" solo puede ser 'question' o 'answer'. No hay 'agreement', y esa
    -- ausencia es la decision 3: ningun agente declara el acuerdo, lo calcula
    -- el codigo de cada lado. Una regla que se puede saltar rellenando otro
    -- campo no es una regla.
    CREATE TABLE IF NOT EXISTS negotiation_turns (
      id TEXT PRIMARY KEY,
      negotiation_id TEXT NOT NULL REFERENCES negotiations(id),
      idx INTEGER NOT NULL,
      side TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      -- Lo revelado, ya pasado por la escalera. Guardado para poder
      -- responder a «que se dijo de mi», que es la pregunta que hara.
      facts TEXT NOT NULL DEFAULT '[]',
      -- Y lo que se quedo fuera, con su motivo. La cuenta es la medida.
      withheld TEXT NOT NULL DEFAULT '[]',
      needs_human TEXT,
      -- El hueco del analisis que este turno estaba cerrando.
      unknown_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS turns_by_negotiation
      ON negotiation_turns (negotiation_id, idx);

    -- La libreta.
    --
    -- No es parte del producto: es donde caben las ideas sobre el producto,
    -- escritas desde el móvil en el momento en que se le ocurren. Vive en la
    -- misma base que todo lo demás porque el disco ya está ahí y montar un
    -- sitio aparte para guardar frases sueltas es cómo se queda sin hacer.
    CREATE TABLE IF NOT EXISTS feedback_notes (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS feedback_notes_by_candidate
      ON feedback_notes (candidate_id, created_at);

    -- Lo que os habeis dicho.
    --
    -- El grafo guarda lo que el es. Esto guarda el estado de una relacion:
    -- que le aconsejo el Rep, sobre que hueco, y que dijo el que iba a hacer.
    -- Son cosas distintas y por eso viven aparte: si se mezclaran, un consejo
    -- acabaria siendo una afirmacion sobre su experiencia, que es justo lo
    -- que no es.
    --
    -- Lo que no es: un historico de chat. Cada fila apunta a incertidumbres,
    -- evidencias u oportunidades que existen, igual que todo lo demas aqui.
    -- Un consejo que no puede citar nada no se guarda, porque un consejo que
    -- no se apoya en nada es un horoscopo y no hace falta recordarlo.
    CREATE TABLE IF NOT EXISTS advice (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      -- De que conversacion salio, para poder releer el hilo entero.
      inbound_message_id TEXT,
      -- 'rep' lo dijo el Rep; 'candidate' lo dijo el.
      side TEXT NOT NULL,
      text TEXT NOT NULL,
      uncertainty_ids TEXT NOT NULL DEFAULT '[]',
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      opportunity_ids TEXT NOT NULL DEFAULT '[]',
      -- 'open' sigue en pie; 'addressed' lo cubrio algo que llego despues;
      -- 'dropped' dejo de tener sentido.
      status TEXT NOT NULL DEFAULT 'open',
      -- Que lo cerro: el id de lo que llego y lo cubrio.
      addressed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS advice_by_candidate
      ON advice (candidate_id, status, created_at);

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
  if (!has('opportunity_questions', 'notified_at')) {
    // Cuándo salió en un mensaje. Las preguntas se acumulan y salen juntas,
    // así que "existe" y "se la he mandado" dejan de ser lo mismo.
    db.exec('ALTER TABLE opportunity_questions ADD COLUMN notified_at TEXT;')
  }
  if (!has('opportunity_questions', 'incorporated_at')) {
    // Cuándo entró la respuesta al grafo. Sin esto, un reintento del trabajo
    // —y hubo uno, tras un "empty response" del modelo— vuelve a extraer los
    // mismos claims y deja dos evidencias por cada frase que dijo una vez.
    db.exec('ALTER TABLE opportunity_questions ADD COLUMN incorporated_at TEXT;')
  }
  if (!has('preferences', 'language')) {
    // En qué idioma habla el Rep. Vive con las preferencias y no en una
    // variable de entorno porque es de la persona, no de la instalación.
    db.exec("ALTER TABLE preferences ADD COLUMN language TEXT;")
  }
  if (!has('notifications', 'external_id')) {
    // Which message this became on the far side, so a reply that quotes it
    // can be traced back to what it was about. Telegram hands the id back
    // when the message is sent, and without it several things in flight at
    // once are indistinguishable on the way home.
    db.exec('ALTER TABLE notifications ADD COLUMN external_id TEXT;')
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS notifications_by_external ON notifications (channel, external_id);',
  )
  if (!has('inbound_messages', 'incorporated_at')) {
    // Cuándo pasó al perfil lo que escribió sin que nadie le preguntase. Es
    // lo que impide que un reintento extraiga dos veces los mismos claims de
    // una frase que dijo una sola vez — el mismo bug que dejó las evidencias
    // duplicadas en las preguntas.
    db.exec('ALTER TABLE inbound_messages ADD COLUMN incorporated_at TEXT;')
  }
  if (!has('inbound_messages', 'answer_sources')) {
    db.exec('ALTER TABLE inbound_messages ADD COLUMN answer_sources TEXT;')
  }
  if (!has('inbound_messages', 'progress')) {
    db.exec('ALTER TABLE inbound_messages ADD COLUMN progress TEXT;')
  }
  if (!has('inbound_messages', 'answer')) {
    // Lo que el Rep le contestó, cuando lo que llegó era una pregunta.
    // Guardado y no solo enviado: la pantalla lo pide después de escribir, y
    // un consejo que se dio una vez tiene que poder releerse.
    db.exec('ALTER TABLE inbound_messages ADD COLUMN answer TEXT;')
    db.exec('ALTER TABLE inbound_messages ADD COLUMN answered_at TEXT;')
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

/**
 * Soltar el fichero.
 *
 * Existe para una cosa: cambiar la base por otra sin reiniciar, que es lo que
 * hace falta para llevarse el grafo del portátil al servidor. Cambiar el
 * fichero por debajo de una conexión abierta es cómo se corrompe una base de
 * SQLite, así que primero se cierra.
 *
 * Es seguro porque `DatabaseSync` es síncrono: mientras el reemplazo ocurra
 * en un solo tick, ninguna petición puede estar a mitad de una sentencia.
 * Cualquier cosa que llegue después vuelve a abrir por `getDb()`.
 */
export function closeDb(): void {
  const db = globalThis.__ambleDb
  globalThis.__ambleDb = undefined
  db?.close()
}

export const DB_FILE = DB_PATH
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

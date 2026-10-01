import { getDb, inTransaction, prepared } from '../db/db'
import { getCandidate, newId, now } from '../db/repo'
import type { MatchRow } from '../db/matching'
import { candidateLocale } from '../i18n/candidate'
import { ASSESS_VERSION, LANGUAGE_GATE, OFFICE_ELSEWHERE_GATE, REMOTE_COUNTRIES_GATE, SALARY_FLOOR_GATE, type Explanation, type Gate } from './assess'
import type { MatchingProfile } from './profile'
import { prefilter, type RoleQuery } from './role-query'

// When a person's rules change, every offer judged with the old ones would be
// judged again: the assessment's key is the profile's fingerprint. Most of
// those judgments still hold, and some can be shown to hold without asking
// the model: an offer set aside by a rule that still stands, word for word,
// is set aside by it again. Those are carried over to the new key; the rest
// (whatever was shown or held, and every discard whose reason the change may
// touch) are read again as before.
//
// Only discards are carried, and only on what decided them:
//   - a hard rule the offer broke that still stands with the same words, and
//     nothing new under "never filter on" that could stay its hand
//   - a published salary below a floor that is the same or higher, same currency
//   - a required language they still do not speak
//   - remote work only elsewhere, or offices only elsewhere (read on the
//     offer's facts), with the same need for remote work, home and offices
//   - another profession or a lower level, when nothing it was judged on
//     changed: capabilities, experience, what weighs for them, their hard
//     rules (only new ones may be added), and for a lower level their pay
//     (the same, or a higher floor)
// A shown or held offer is always read again: a new rule could fail it, and
// a good offer must never be lost on a guess. An answer in another language
// is read again too (what they read would be in the old one).

// What an assessment was made with: the profile as the assessor read it and
// what the domain rules took from the role query.
export interface MatchingSnapshot {
  hardFilters: [string, string][]
  strong: [string, string][]
  compensation: [string, string][]
  notFilteringOn: string[]
  capabilities: [string, string, string, boolean][]
  experience: string[]
  locale: string | null
  query: Pick<RoleQuery, 'salaryFloor' | 'languages' | 'requireRemote' | 'officeAllowed' | 'homeCountry'>
}

export function snapshotOf(candidateId: string, profile: MatchingProfile, query: RoleQuery): MatchingSnapshot {
  const rules = (kind: MatchingProfile['rules'][number]['kind']) =>
    profile.rules.filter((rule) => rule.kind === kind).map((rule): [string, string] => [rule.id, rule.statement])
  return {
    hardFilters: rules('hard_filter'),
    strong: rules('strong'),
    compensation: rules('compensation'),
    notFilteringOn: profile.notFilteringOn.map((item) => item.statement),
    capabilities: profile.capabilities.map((capability): [string, string, string, boolean] => [capability.id, capability.name, capability.assessment, capability.attributed]),
    experience: profile.experience,
    locale: candidateLocale(getCandidate(candidateId) ?? null),
    query: {
      salaryFloor: query.salaryFloor,
      languages: query.languages,
      requireRemote: query.requireRemote,
      officeAllowed: query.officeAllowed,
      homeCountry: query.homeCountry,
    },
  }
}

// Kept once per key: the first record of what a key was made with stands.
export function recordSnapshot(candidateId: string, matchKey: string, snapshot: MatchingSnapshot): void {
  prepared('INSERT OR IGNORE INTO matching_snapshots (candidate_id, match_key, snapshot, created_at) VALUES (?, ?, ?, ?)').run(
    candidateId,
    matchKey,
    JSON.stringify(snapshot),
    now(),
  )
}

function snapshotsOf(candidateId: string): Map<string, MatchingSnapshot> {
  const rows = getDb().prepare('SELECT match_key, snapshot FROM matching_snapshots WHERE candidate_id = ?').all(candidateId) as unknown as {
    match_key: string
    snapshot: string
  }[]
  return new Map(rows.map((row) => [row.match_key, JSON.parse(row.snapshot) as MatchingSnapshot]))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameSet = (a: string[], b: string[]) => same([...a].sort(), [...b].sort())

export type CarryDecision = { carry: true; reason: string } | { carry: false; reason: string }

// Whether a judgment made with `before` still stands with `after`, and why.
export function carryDecision(row: { verdict: MatchRow['verdict']; gates: Gate[]; explanation: Explanation }, before: MatchingSnapshot, after: MatchingSnapshot): CarryDecision {
  if (row.verdict !== 'discarded') return { carry: false, reason: `${row.verdict}: read again` }
  if (before.locale !== after.locale) return { carry: false, reason: 'another language' }
  const nothingNewSpared = after.notFilteringOn.every((statement) => before.notFilteringOn.includes(statement))
  const floorBefore = before.query.salaryFloor
  const floorAfter = after.query.salaryFloor
  const floorKeptOrRaised = Boolean(floorBefore && floorAfter && floorBefore.currency === floorAfter.currency && floorAfter.amount >= floorBefore.amount)

  for (const gate of row.gates) {
    if (gate.result !== 'fail') continue
    if (gate.ruleId === SALARY_FLOOR_GATE) {
      if (floorKeptOrRaised) return { carry: true, reason: `${SALARY_FLOOR_GATE}: floor kept or raised` }
    } else if (gate.ruleId === LANGUAGE_GATE) {
      const required = gate.note.split('/').map((code) => code.trim()).filter(Boolean)
      if (required.length > 0 && after.query.languages.length > 0 && required.every((code) => !after.query.languages.includes(code))) {
        return { carry: true, reason: `${LANGUAGE_GATE}: still not spoken` }
      }
    } else if (gate.ruleId === REMOTE_COUNTRIES_GATE || gate.ruleId === OFFICE_ELSEWHERE_GATE) {
      const { requireRemote, homeCountry, officeAllowed } = after.query
      if (requireRemote && before.query.requireRemote && homeCountry === before.query.homeCountry && sameSet(officeAllowed, before.query.officeAllowed)) {
        return { carry: true, reason: `${gate.ruleId}: same need for remote work, home and offices` }
      }
    } else if (!gate.ruleId.startsWith('amble:')) {
      const statement = before.hardFilters.find(([id]) => id === gate.ruleId)?.[1]
      const stands = statement !== undefined && after.hardFilters.some(([id, words]) => id === gate.ruleId && words === statement)
      if (stands && nothingNewSpared) return { carry: true, reason: `${gate.ruleId}: the rule stands unchanged` }
    }
  }

  const fit = row.explanation.roleFit?.fit
  if (fit === 'wrong_role' || fit === 'below_level') {
    const hardKept = before.hardFilters.every(([id, words]) => after.hardFilters.some(([otherId, otherWords]) => otherId === id && otherWords === words))
    const judgedOnTheSame =
      same(before.capabilities, after.capabilities) && same(before.experience, after.experience) && same(before.strong, after.strong) && hardKept && nothingNewSpared
    const payKept = same(before.compensation, after.compensation) || floorKeptOrRaised
    if (judgedOnTheSame && (fit === 'wrong_role' || payKept)) return { carry: true, reason: `${fit}: judged on nothing that changed` }
  }
  return { carry: false, reason: 'its reason may have changed' }
}

type EarlierRow = MatchRow & { title: string; location: string | null; workplace: string | null; closed_at: string | null }

export interface CarryStats {
  // Earlier judgments of open offers of their role, not yet judged with this profile.
  considered: number
  carried: number
  // Judged with a profile whose record was not kept (before carrying existed).
  unknownProfile: number
  reasons: Record<string, number>
}

// Carries over to `matchKey` what still stands of the latest earlier
// judgment of each open offer that passes the new query's prefilter. One
// role's postings judged together are carried together, or not at all.
export function carryOver(candidateId: string, matchKey: string, after: MatchingSnapshot, query: RoleQuery): CarryStats {
  const stats: CarryStats = { considered: 0, carried: 0, unknownProfile: 0, reasons: {} }
  const snapshots = snapshotsOf(candidateId)
  const rows = getDb()
    .prepare(
      `SELECT m.*, o.title, o.location, o.workplace, o.closed_at
       FROM opportunity_matches m
       JOIN opportunities o ON o.id = m.opportunity_id
       WHERE m.candidate_id = ? AND m.profile_hash LIKE ? AND m.profile_hash != ? AND o.closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM opportunity_matches c WHERE c.opportunity_id = m.opportunity_id AND c.profile_hash = ?)
       ORDER BY m.created_at DESC, m.carried_from IS NOT NULL, m.rowid`,
    )
    .all(candidateId, `%:${ASSESS_VERSION}`, matchKey, matchKey) as unknown as EarlierRow[]
  // The latest judgment of each offer is the one that stands (an original
  // before a copy of it made at the same moment).
  const latest = new Map<string, EarlierRow>()
  for (const row of rows) if (!latest.has(row.opportunity_id)) latest.set(row.opportunity_id, row)

  // By the judgment they were part of: one model run for every city's posting.
  const groups = new Map<string, EarlierRow[]>()
  for (const row of latest.values()) {
    if (!prefilter(row, query).pass) continue
    stats.considered++
    const key = `${row.profile_hash}|${row.model_run_id ?? row.id}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const carried: { row: EarlierRow; reason: string }[] = []
  for (const group of groups.values()) {
    const before = snapshots.get(group[0].profile_hash)
    if (!before) {
      stats.unknownProfile += group.length
      continue
    }
    const decisions = group.map((row) =>
      carryDecision({ verdict: row.verdict, gates: JSON.parse(row.gates) as Gate[], explanation: JSON.parse(row.explanation) as Explanation }, before, after),
    )
    const all = decisions.every((decision) => decision.carry)
    decisions.forEach((decision, index) => {
      const reason = all ? decision.reason : decision.carry ? 'another posting of the role is read again' : decision.reason
      const label = `${all ? 'carried' : 'read again'}: ${reason.includes(': ') ? reason.slice(0, reason.indexOf(': ')) : reason}`
      stats.reasons[label] = (stats.reasons[label] ?? 0) + 1
      if (all) carried.push({ row: group[index], reason })
    })
  }

  if (carried.length > 0) {
    // The judgment as it was made, under the new key: its verdict, reasons and
    // model run (one role stays one role), its date (it was read then, not
    // now), and where it came from.
    const insert = prepared(
      `INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, dropped, model_run_id, created_at,
         response, response_reason, responded_at, carried_from, carried_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(opportunity_id, profile_hash) DO NOTHING`,
    )
    inTransaction(() => {
      for (const { row, reason } of carried) {
        const result = insert.run(
          newId('mat'),
          candidateId,
          row.opportunity_id,
          matchKey,
          row.verdict,
          row.gates,
          row.explanation,
          row.dropped,
          row.model_run_id,
          row.created_at,
          row.response,
          row.response_reason,
          row.responded_at,
          row.profile_hash,
          reason,
        )
        stats.carried += Number(result.changes)
      }
    })
  }
  return stats
}

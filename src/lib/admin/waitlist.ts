import fs from 'node:fs'
import postgres from 'postgres'
import type { Locale } from '../i18n/locale'

// The site's waitlist (amble-web, its own Postgres), read for the owner's
// admin. amble never writes there: who was let in is kept in amble's own
// database (waitlist_invites). The connection is opened read only, so a
// mistake here cannot change the site's list either.
//
// AMBLE_WAITLIST_DATABASE_URL  the site's database (on Railway, a reference
//                              to its Postgres; the public URL from another region)
// AMBLE_WAITLIST_FIXTURE       outside production only: a JSON file of entries,
//                              to try the admin without any database

export type WaitlistAudience = 'candidate' | 'company'

export interface WaitlistEntry {
  email: string
  // The address as the site compares it: lowercase, trimmed.
  normalized: string
  locale: Locale
  audience: WaitlistAudience
  created_at: string
}

declare global {
  var __ambleWaitlistSql: postgres.Sql | undefined
}

function fixturePath(): string | null {
  if (process.env.NODE_ENV === 'production') return null
  return process.env.AMBLE_WAITLIST_FIXTURE?.trim() || null
}

function databaseUrl(): string | null {
  return process.env.AMBLE_WAITLIST_DATABASE_URL?.trim() || null
}

export function waitlistConnected(): boolean {
  return Boolean(databaseUrl() || fixturePath())
}

function sql(url: string): postgres.Sql {
  globalThis.__ambleWaitlistSql ??= postgres(url, {
    max: 2,
    idle_timeout: 30,
    connect_timeout: 10,
    // Nothing this connection runs can write.
    connection: { default_transaction_read_only: true, application_name: 'amble-admin' },
  })
  return globalThis.__ambleWaitlistSql
}

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

function asEntry(row: { email: string; normalized?: string; locale?: string; audience?: string; created_at: string | Date }): WaitlistEntry {
  return {
    email: row.email,
    normalized: normalize(row.normalized ?? row.email),
    locale: row.locale === 'es' ? 'es' : 'en',
    audience: row.audience === 'company' ? 'company' : 'candidate',
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  }
}

// Everyone on the list, newest first. Throws when the database cannot be
// reached; the admin says so instead of showing an empty list.
export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const fixture = fixturePath()
  if (fixture) {
    const rows = JSON.parse(fs.readFileSync(fixture, 'utf8')) as Parameters<typeof asEntry>[0][]
    return rows.map(asEntry).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  const url = databaseUrl()
  if (!url) return []
  const rows = await sql(url)<{ email: string; normalized: string; locale: string; audience: string; created_at: Date }[]>`
    select email, email_normalized as normalized, locale, audience, created_at
    from waitlist
    order by created_at desc
    limit 5000
  `
  return rows.map(asEntry)
}

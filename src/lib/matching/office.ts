import { normalise } from './assess'
import { cityAreaTerms, placeOf } from './places'
import type { RoleQuery } from './role-query'

// A hybrid or on-site role in none of the cities where they accept an office,
// for someone who otherwise needs remote work: not theirs, however it was
// judged. A judgment can be older than what is known of the role now (it was
// read as remote, then its board said hybrid: LabHouse's Creative Director in
// Barcelona, shown on 2026-10-10 to someone who takes an office only in
// Valencia). Checked where offers are shown, released and sent, so no model
// call is needed for it.
export function officeNotAllowed(location: string | null, workplace: string | null, query: RoleQuery | null): boolean {
  if (!query?.requireRemote || (workplace !== 'hybrid' && workplace !== 'onsite')) return false
  const places = (location ?? '')
    .split(/[·;|/•]/)
    .map((segment) => placeOf(segment))
    .filter((place): place is string => place !== null)
  // A role that names no place cannot be placed outside theirs.
  if (places.length === 0) return false
  return !places.some((place) => query.officeAllowed.some((term) => cityAreaTerms(normalise(term)).some((town) => ` ${place} `.includes(` ${town} `))))
}

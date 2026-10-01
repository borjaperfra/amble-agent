// What they said they look for, row by row, in the order the screens show it.
// Pay, where and the role are always shown, said or not: without them the Rep
// shows offers it cannot rule out. Shared by the screen that asks and the one
// that listens.
export const INTENT_ORDER = ['Compensation', 'Location', 'Role', 'Company', 'Ownership', 'Space', 'Not interested in', 'Other']
export const INTENT_CORE = ['Compensation', 'Location', 'Role'] as const
export type IntentCore = (typeof INTENT_CORE)[number]

export interface IntentRow {
  label: string
  values: string[]
}

// The groups as rows: the fixed ones first (a core one not said, empty), the
// rest (their words kept as they were) after.
export function intentRows(groups: IntentRow[]): IntentRow[] {
  const known = INTENT_ORDER.flatMap((label) => {
    const group = groups.find((item) => item.label === label)
    if (group) return [{ label, values: group.values }]
    return (INTENT_CORE as readonly string[]).includes(label) ? [{ label, values: [] }] : []
  })
  return [...known, ...groups.filter((group) => !INTENT_ORDER.includes(group.label))]
}

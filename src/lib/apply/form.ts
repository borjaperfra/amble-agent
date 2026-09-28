import { getDb } from '../db/db'

// The application form of an offer, read from the ATS's public job board:
// what it asks, how, and whether it must be answered. Greenhouse and Ashby
// publish it; for the rest only the fields every form has are known.

export type FieldKind = 'name' | 'email' | 'phone' | 'resume' | 'cover_letter' | 'linkedin' | 'website' | 'text' | 'long_text' | 'choice' | 'yes_no' | 'file'

export interface FormField {
  id: string
  label: string
  kind: FieldKind
  required: boolean
  options: string[]
}

export interface ApplicationForm {
  source: 'greenhouse' | 'ashby' | 'generic'
  fields: FormField[]
}

const TIMEOUT_MS = 15_000

// What a label says the field is, whatever the ATS calls its type.
function kindFromLabel(label: string, fallback: FieldKind): FieldKind {
  const l = label.toLowerCase()
  if (/linkedin/.test(l)) return 'linkedin'
  if (/github|website|portfolio|personal site/.test(l)) return 'website'
  if (/cover letter/.test(l)) return 'cover_letter'
  if (/^(resume|cv)\b|resume\/cv/.test(l)) return 'resume'
  if (/phone/.test(l)) return 'phone'
  if (/^e-?mail/.test(l)) return 'email'
  if (/^(full |first |last )?name$/.test(l)) return 'name'
  return fallback
}

interface GreenhouseQuestion {
  label: string
  required: boolean
  fields: { name: string; type: string; values?: { label: string }[] }[]
}

async function greenhouseForm(token: string, jobId: string): Promise<ApplicationForm | null> {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}?questions=true`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!response.ok) return null
  const data = (await response.json()) as { questions?: GreenhouseQuestion[] }
  const fields = (data.questions ?? []).map((question, index): FormField => {
    const field = question.fields[0]
    const type = field?.type ?? 'input_text'
    const base: FieldKind =
      type === 'textarea'
        ? 'long_text'
        : type === 'input_file'
          ? 'file'
          : type.startsWith('multi_value')
            ? 'choice'
            : 'text'
    return {
      id: field?.name ?? `q${index}`,
      label: question.label,
      kind: kindFromLabel(question.label, base),
      required: question.required,
      options: (field?.values ?? []).map((value) => value.label),
    }
  })
  return { source: 'greenhouse', fields }
}

interface AshbyEntry {
  id: string
  isRequired: boolean
  field: { path: string; title: string; type: string; selectableValues?: { label: string }[] }
}

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { id isRequired field } } } }
  }
}`

async function ashbyForm(board: string, postingId: string): Promise<ApplicationForm | null> {
  const response = await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'ApiJobPosting',
      variables: { organizationHostedJobsPageName: board, jobPostingId: postingId },
      query: ASHBY_QUERY,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) return null
  const data = (await response.json()) as {
    data?: { jobPosting?: { applicationForm?: { sections?: { fieldEntries?: AshbyEntry[] }[] } } | null }
  }
  const entries = (data.data?.jobPosting?.applicationForm?.sections ?? []).flatMap((section) => section.fieldEntries ?? [])
  if (entries.length === 0) return null
  const fields = entries
    .filter((entry) => entry.field?.title)
    .map((entry): FormField => {
      const { path, title, type } = entry.field
      const base: FieldKind =
        path === '_systemfield_name'
          ? 'name'
          : path === '_systemfield_email'
            ? 'email'
            : path === '_systemfield_resume'
              ? 'resume'
              : type === 'LongText'
                ? 'long_text'
                : type === 'File'
                  ? 'file'
                  : type === 'Boolean'
                    ? 'yes_no'
                    : type === 'ValueSelect' || type === 'MultiValueSelect'
                      ? 'choice'
                      : type === 'Phone'
                        ? 'phone'
                        : 'text'
      return {
        id: path,
        label: title,
        kind: base === 'text' || base === 'file' ? kindFromLabel(title, base) : base,
        required: entry.isRequired,
        options: (entry.field.selectableValues ?? []).map((value) => value.label),
      }
    })
  return { source: 'ashby', fields }
}

// What every form asks, for boards that do not publish theirs.
const GENERIC: FormField[] = [
  { id: 'name', label: 'Name', kind: 'name', required: true, options: [] },
  { id: 'email', label: 'Email', kind: 'email', required: true, options: [] },
  { id: 'resume', label: 'Resume / CV', kind: 'resume', required: true, options: [] },
  { id: 'linkedin', label: 'LinkedIn', kind: 'linkedin', required: false, options: [] },
  { id: 'cover_letter', label: 'Cover letter', kind: 'cover_letter', required: false, options: [] },
]

interface SourceRow {
  source: string
  external_id: string
  ats_token: string | null
}

export async function readApplicationForm(opportunityId: string): Promise<ApplicationForm> {
  const row = getDb()
    .prepare(
      `SELECT s.source, s.external_id, c.ats_token FROM opportunity_sources s
       JOIN opportunities o ON o.id = s.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE s.opportunity_id = ? AND s.closed_at IS NULL ORDER BY s.last_seen_at DESC LIMIT 1`,
    )
    .get(opportunityId) as SourceRow | undefined
  try {
    if (row?.ats_token && row.source === 'greenhouse') {
      const form = await greenhouseForm(row.ats_token, row.external_id)
      if (form) return form
    }
    if (row?.ats_token && row.source === 'ashby') {
      const form = await ashbyForm(row.ats_token, row.external_id)
      if (form) return form
    }
  } catch {
    // An unreadable form is not a failure: the usual fields still apply.
  }
  return { source: 'generic', fields: GENERIC }
}

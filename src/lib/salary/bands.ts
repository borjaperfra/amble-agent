// The reference table for estimating what an offer pays when it publishes no
// salary (estimate.ts). Gross yearly pay in euros, by role and experience in
// Spain, copied from a public Spanish salary guide. These rows are the only
// figures amble ever shows as an estimate: no model writes or changes a
// number, and every estimate carries the source, year and page it came from.
//
// Source: Manfred only (getmanfred.com), Guía salarial 2026, the web page
// (published 2026-01-12, updated 2026-01-19), from its community of more than
// 120,000 tech professionals: a range per role and experience bracket for
// Spain as a whole. Each row links to the section of the page it is in. Read
// on 2026-09-30.
//   - Manfred publishes no figures by city. The guide only says that on-site
//     jobs pay at least 20% more; that is not applied: the rows are copied as
//     they are.
//   - The PDF of the same guide (linked from the page) differs from the page
//     in a few rows (Backend and Frontend over 5 years, SRE/DevOps under 2,
//     Software Architect 2-5, Engineering Manager 5-10, Product Manager over
//     10). The page is the one copied, and the one each estimate links to.
//   - VP of Engineering and CTO/Head of Engineering come with equity on top
//     (0.1-3% by row); only the salary is copied.
// Consulted and not used: Manfred's Tech Career Report 2025
// (getmanfred.com/developer-career-report), which gives the share of people
// in each salary bucket, not a range, so it would take a calculation of ours
// to turn it into one; and its Brújula Salarial, behind a sign-in.
// Not used on purpose: Hays (its figures could only be read by scripting its
// calculator) and any other guide. A role Manfred has no row for gets no
// estimate: developer relations, technical writing, product marketing, all
// of marketing and communication, presales, QA management, cloud,
// security analysis and architecture, product ownership, UX research and
// writing, design leadership. Their offers are placed (so they are counted).
//
// When to review it: once a year, when the new edition comes out (Manfred
// publishes it in January). How:
//   1. Open the new guide's web page and copy each role's brackets into the
//      rows below, with the page's URL and section. Add a row for any role or
//      bracket it now has; remove any it dropped.
//   2. Check whether Manfred now publishes figures by city, or for the roles
//      with none (above), and add them.
//   3. Change SOURCES.manfred (year, title, url) and BANDS_VERSION: every
//      estimate is computed again from the new table the next time the offer
//      is read (they are kept with the version).
//   4. Run the checks: npx tsc --noEmit, and look at a few offers' estimates
//      on /opportunities.

export const BANDS_VERSION = '2026.2'

// Where an estimate is for. 'spain' is the rest of Spain, or remote from
// Spain: a Spain-wide row when the source has one.
export type Place = 'madrid' | 'barcelona' | 'valencia' | 'spain'

// The levels an offer's title (or the experience it asks for) says.
export type Level = 'junior' | 'mid' | 'senior' | 'lead' | 'head'

// The years of experience each level stands for, to pick a source's bracket.
// A source's "2-5 años" is taken to include the fifth year ([2, 6)).
export const LEVEL_YEARS: Record<Level, readonly [number, number]> = {
  junior: [0, 2],
  mid: [2, 5],
  senior: [5, 10],
  lead: [6, 15],
  head: [10, 20],
}

const MANFRED_PAGE = 'https://www.getmanfred.com/blog/guia-salarial-2026-salarios-en-tecnologia-espana-manfred'

export const SOURCES = {
  manfred: {
    name: 'Manfred',
    year: 2026,
    title: 'Guía salarial 2026',
    url: MANFRED_PAGE,
  },
} as const

export type SourceId = keyof typeof SOURCES

// Every role an offer's title can be placed in (map.ts), with or without a
// row. Those without one are counted, and get no estimate.
export const ROLES = [
  'backend',
  'brand_manager',
  'ciso',
  'cloud_architect',
  'cloud_engineer',
  'comms_director',
  'comms_manager',
  'comms_technician',
  'community_manager',
  'content_manager',
  'content_specialist',
  'copywriter',
  'crm_manager',
  'data_analyst',
  'data_architect',
  'data_engineer',
  'data_scientist',
  'devops',
  'devrel',
  'digital_analyst',
  'digital_marketing_manager',
  'digital_marketing_specialist',
  'email_marketing',
  'engineering_manager',
  'frontend',
  'fullstack',
  'graphic_designer',
  'growth_manager',
  'head_of_design',
  'head_of_engineering',
  'head_of_partnerships',
  'head_of_product',
  'influencer_marketing',
  'marketing_assistant',
  'marketing_automation',
  'marketing_director',
  'marketing_manager',
  'marketing_technician',
  'martech_director',
  'martech_specialist',
  'ml_engineer',
  'mlops',
  'mobile',
  'paid_media_director',
  'pentester',
  'performance_manager',
  'performance_specialist',
  'pr_events_manager',
  'presales_engineer',
  'presales_manager',
  'product_designer',
  'product_manager',
  'product_marketing',
  'product_owner',
  'qa_manager',
  'qa_tester',
  'security_analyst',
  'security_architect',
  'security_engineer',
  'sem_manager',
  'sem_specialist',
  'seo_manager',
  'seo_specialist',
  'social_media_manager',
  'software_architect',
  'staff_engineer',
  'sysadmin',
  'tech_lead',
  'technical_writer',
  'trade_marketing',
  'user_acquisition_manager',
  'ux_researcher',
  'ux_writer',
  'vp_engineering',
] as const

export type Role = (typeof ROLES)[number]

export interface Band {
  role: Role
  source: SourceId
  // The row as the source names it, and the experience bracket it is for.
  name: string
  experience: string
  years: readonly [number, number]
  // A position the source gives for a level of its own ("Staff Engineer",
  // "CTO"): only offers at one of these levels take it.
  levels?: readonly Level[]
  place: Place | 'bilbao' | 'sevilla'
  min: number
  max: number
  // The page (and section) the row is copied from.
  url: string
}

// The sections of Manfred's page, as its own anchors name them.
const SECTION = {
  development: '#guia-salarial-de-tecnologia-2026-espana',
  infrastructure: '#salarios-sistema-e-infraestructura',
  data: '#salarios-data',
  leadership: '#salarios-liderazgo-tecnico',
  product: '#salarios-producto',
  security: '#salarios-ciberseguridad',
} as const

const BRACKETS = {
  '<2 años': [0, 2],
  '2-5 años': [2, 6],
  '5-10 años': [5, 11],
  '>10 años': [10, 20],
} as const

type Bracket = keyof typeof BRACKETS

// One Manfred role, a row per bracket it gives, for Spain as a whole.
function manfred(
  role: Role,
  name: string,
  section: keyof typeof SECTION,
  brackets: Partial<Record<Bracket, readonly [number, number]>>,
  levels?: readonly Level[],
): Band[] {
  return (Object.entries(brackets) as [Bracket, readonly [number, number]][]).map(([experience, range]) => ({
    role,
    source: 'manfred',
    name,
    experience,
    years: BRACKETS[experience],
    levels,
    place: 'spain',
    min: range[0],
    max: range[1],
    url: `${MANFRED_PAGE}${SECTION[section]}`,
  }))
}

export const BANDS: readonly Band[] = [
  // Development.
  ...manfred('backend', 'Backend Engineer', 'development', { '<2 años': [20000, 30000], '2-5 años': [31000, 40000], '5-10 años': [41000, 50000], '>10 años': [51000, 55000] }),
  ...manfred('frontend', 'Frontend Engineer', 'development', { '<2 años': [20000, 30000], '2-5 años': [31000, 35000], '5-10 años': [35000, 40000], '>10 años': [40000, 50000] }),
  ...manfred('fullstack', 'Full-Stack Engineer', 'development', { '<2 años': [20000, 30000], '2-5 años': [31000, 40000], '5-10 años': [41000, 50000], '>10 años': [51000, 60000] }),
  ...manfred('ml_engineer', 'AI Engineer', 'development', { '<2 años': [25000, 35000], '2-5 años': [36000, 50000], '5-10 años': [51000, 70000], '>10 años': [71000, 90000] }),
  ...manfred('mobile', 'Mobile', 'development', { '<2 años': [20000, 30000], '2-5 años': [31000, 40000], '5-10 años': [41000, 45000], '>10 años': [46000, 50000] }),
  ...manfred('qa_tester', 'QA & Testing', 'development', { '<2 años': [20000, 25000], '2-5 años': [26000, 32000], '5-10 años': [33000, 40000], '>10 años': [41000, 45000] }),
  // Systems and infrastructure.
  ...manfred('sysadmin', 'SysAdmin', 'infrastructure', { '<2 años': [20000, 25000], '2-5 años': [26000, 35000], '5-10 años': [36000, 45000], '>10 años': [46000, 50000] }),
  ...manfred('devops', 'SRE/DevOps', 'infrastructure', { '<2 años': [25000, 35000], '2-5 años': [36000, 45000], '5-10 años': [46000, 60000], '>10 años': [61000, 80000] }),
  // Data.
  ...manfred('data_engineer', 'Data Engineer', 'data', { '<2 años': [25000, 35000], '2-5 años': [36000, 45000], '5-10 años': [46000, 60000], '>10 años': [61000, 80000] }),
  ...manfred('data_scientist', 'Data Scientist', 'data', { '<2 años': [25000, 35000], '2-5 años': [36000, 50000], '5-10 años': [51000, 70000], '>10 años': [71000, 100000] }),
  ...manfred('data_analyst', 'Data Analyst', 'data', { '<2 años': [20000, 25000], '2-5 años': [26000, 35000], '5-10 años': [36000, 42000], '>10 años': [43000, 50000] }),
  ...manfred('mlops', 'MLOps', 'data', { '<2 años': [25000, 35000], '2-5 años': [36000, 50000], '5-10 años': [51000, 75000], '>10 años': [75000, 100000] }),
  ...manfred('data_architect', 'Data Architect', 'data', { '2-5 años': [40000, 55000], '5-10 años': [56000, 75000], '>10 años': [75000, 100000] }),
  // Technical leadership.
  ...manfred('software_architect', 'Software Architect', 'leadership', { '2-5 años': [40000, 50000], '5-10 años': [51000, 75000], '>10 años': [75000, 100000] }),
  ...manfred('tech_lead', 'Tech Lead', 'leadership', { '2-5 años': [40000, 50000], '5-10 años': [51000, 65000], '>10 años': [65000, 80000] }),
  ...manfred('staff_engineer', 'Staff Engineer', 'leadership', { '5-10 años': [65000, 85000], '>10 años': [86000, 120000] }, ['senior', 'lead', 'head']),
  ...manfred('engineering_manager', 'Engineering Manager', 'leadership', { '5-10 años': [60000, 85000], '>10 años': [86000, 110000] }),
  ...manfred('vp_engineering', 'VP of Engineering', 'leadership', { '5-10 años': [75000, 110000], '>10 años': [110000, 150000] }, ['head']),
  ...manfred('head_of_engineering', 'CTO/Head of Engineering', 'leadership', { '5-10 años': [55000, 90000], '>10 años': [91000, 140000] }, ['head']),
  // Product.
  ...manfred('product_manager', 'Product Manager', 'product', { '2-5 años': [31000, 45000], '5-10 años': [46000, 55000], '>10 años': [55000, 80000] }),
  ...manfred('product_designer', 'Product Designer', 'product', { '<2 años': [20000, 25000], '2-5 años': [26000, 30000], '5-10 años': [31000, 40000], '>10 años': [41000, 50000] }),
  // Cybersecurity.
  ...manfred('security_engineer', 'Security/Cybersecurity Engineer', 'security', { '<2 años': [25000, 30000], '2-5 años': [31000, 40000], '5-10 años': [41000, 55000], '>10 años': [56000, 80000] }),
]

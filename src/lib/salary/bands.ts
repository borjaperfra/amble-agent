// The reference table for estimating what an offer pays when it publishes no
// salary (estimate.ts). Gross yearly pay in euros, by role, experience and
// place in Spain, copied from public Spanish salary guides. These rows are the
// only figures amble ever shows as an estimate: no model writes or changes a
// number, and every estimate carries the source, year and row it came from.
//
// Sources (edition 2026):
//   - Hays, Guía del Mercado Laboral 2026, through its public salary
//     calculator (guiasalarial.hays.es/profesional/calculadora-salarial):
//     a minimum and maximum per position, experience bracket and city
//     (Madrid, Barcelona, Valencia, Bilbao, Sevilla). Sectors IT, Digital and
//     Marketing y Ventas (the latter from its "Gran consumo" and "Industria"
//     tables). Read on 2026-09-30.
//   - Manfred, Guía salarial 2026 (getmanfred.com), from its community of
//     more than 120,000 tech professionals: a range per role and experience
//     bracket for Spain as a whole (it has no cities). Read on 2026-09-30.
// Consulted and not used: Tecnoempleo's Informe de empleo TIC (one mean range
// per role, with no experience or city); Michael Page, Adecco, Robert Walters
// and the Hays guide's PDF (behind a form); levels.fyi (its Spain and Madrid
// figures disagree with each other).
// With no public Spanish source yet: developer relations, technical writing
// and product marketing. Their offers are placed (so they are counted) but get
// no estimate until a source is added.
//
// When to review it: once a year, when the new editions come out (Hays and
// Manfred publish theirs in January). How:
//   1. For each Hays row below, ask the calculator for the same sector,
//      position and experience in each city, and copy its minimum and maximum.
//      Add a row for any bracket or position it now has that matches a role.
//   2. Copy each Manfred role's brackets from the new guide.
//   3. Check any other public guide that now publishes figures for the roles
//      with none (above), and add it to SOURCES.
//   4. Change BANDS_VERSION: every estimate is computed again from the new
//      table the next time the offer is read (they are kept with the version).
//   5. Run the check in scripts or by hand: npx tsc --noEmit, and look at a
//      few offers' estimates on /opportunities.

export const BANDS_VERSION = '2026.1'

// Where an estimate is for. 'spain' is the rest of Spain, or remote from
// Spain: a Spain-wide row when the source has one.
export type Place = 'madrid' | 'barcelona' | 'valencia' | 'spain'

// The levels an offer's title (or the experience it asks for) says.
export type Level = 'junior' | 'mid' | 'senior' | 'lead' | 'head'

// The years of experience each level stands for, to pick a source's bracket.
// A source's "3-5 años" is taken to include the fifth year ([3, 6)).
export const LEVEL_YEARS: Record<Level, readonly [number, number]> = {
  junior: [0, 2],
  mid: [2, 5],
  senior: [5, 10],
  lead: [6, 15],
  head: [10, 20],
}

export const SOURCES = {
  hays: {
    name: 'Hays',
    year: 2026,
    title: 'Guía del Mercado Laboral 2026',
    url: 'https://guiasalarial.hays.es/profesional/calculadora-salarial',
  },
  manfred: {
    name: 'Manfred',
    year: 2026,
    title: 'Guía salarial 2026',
    url: 'https://www.getmanfred.com/blog/guia-salarial-2026-salarios-en-tecnologia-espana-manfred',
  },
} as const

export type SourceId = keyof typeof SOURCES

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
  'cto',
  'data_analyst',
  'data_architect',
  'data_engineer',
  'data_scientist',
  'devops',
  'devrel',
  'digital_analyst',
  'digital_marketing_manager',
  'digital_marketing_specialist',
  'dotnet_developer',
  'email_marketing',
  'engineering_manager',
  'frontend',
  'fullstack',
  'golang_developer',
  'graphic_designer',
  'growth_manager',
  'head_of_design',
  'head_of_engineering',
  'head_of_partnerships',
  'head_of_product',
  'influencer_marketing',
  'java_developer',
  'marketing_assistant',
  'marketing_automation',
  'marketing_director',
  'marketing_manager',
  'marketing_technician',
  'martech_director',
  'martech_specialist',
  'ml_engineer',
  'mobile',
  'mobile_android',
  'mobile_ios',
  'node_developer',
  'paid_media_director',
  'pentester',
  'performance_manager',
  'performance_specialist',
  'php_developer',
  'pr_events_manager',
  'presales_engineer',
  'presales_manager',
  'product_designer',
  'product_manager',
  'product_marketing',
  'product_owner',
  'python_developer',
  'qa_automation',
  'qa_lead',
  'qa_manager',
  'qa_tester',
  'ruby_developer',
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
  'ui_designer',
  'user_acquisition_manager',
  'ux_designer',
  'ux_researcher',
  'ux_ui_designer',
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
  // A position the source gives for a level of its own ("Head of design",
  // "CTO"): only offers at one of these levels take it.
  levels?: readonly Level[]
  place: Place | 'bilbao' | 'sevilla'
  min: number
  max: number
}

type Cities = Partial<Record<'madrid' | 'barcelona' | 'valencia' | 'bilbao' | 'sevilla', readonly [number, number]>>

// One Hays position and bracket, a row per city it gives.
function hays(
  role: Role,
  name: string,
  experience: string,
  years: readonly [number, number],
  cities: Cities,
  levels?: readonly Level[],
): Band[] {
  return Object.entries(cities).map(([place, range]) => ({
    role,
    source: 'hays',
    name,
    experience,
    years,
    levels,
    place: place as Band['place'],
    min: range[0],
    max: range[1],
  }))
}

// One Manfred role and bracket, for Spain as a whole.
function manfred(role: Role, name: string, experience: string, years: readonly [number, number], range: readonly [number, number], levels?: readonly Level[]): Band {
  return { role, source: 'manfred', name, experience, years, levels, place: 'spain', min: range[0], max: range[1] }
}

export const BANDS: readonly Band[] = [
  manfred('backend', 'Backend Engineer', '<2 años', [0, 2], [20000, 30000]),
  manfred('backend', 'Backend Engineer', '2-5 años', [2, 6], [31000, 40000]),
  manfred('backend', 'Backend Engineer', '5-10 años', [5, 11], [41000, 50000]),
  manfred('backend', 'Backend Engineer', '>10 años', [10, 20], [51000, 55000]),
  ...hays('brand_manager', 'Brand manager', '<5 años', [0, 5], { madrid: [38000, 45000], barcelona: [38000, 45000], valencia: [38000, 41000], bilbao: [36000, 41000], sevilla: [35000, 38000] }),
  ...hays('brand_manager', 'Brand manager', '>5 años', [5, 15], { madrid: [45000, 65000], barcelona: [50000, 55000], valencia: [48000, 52000], bilbao: [45000, 55000], sevilla: [38000, 51000] }),
  ...hays('ciso', 'Ciso (chief information security officer)', '<2 años', [0, 2], { madrid: [80000, 100000], barcelona: [80000, 100000], valencia: [60000, 70000], bilbao: [60000, 70000], sevilla: [60000, 70000] }, ['head']),
  ...hays('ciso', 'Ciso (chief information security officer)', '2-5 años', [2, 6], { madrid: [100000, 120000], barcelona: [100000, 120000], valencia: [70000, 80000], bilbao: [70000, 80000], sevilla: [70000, 80000] }, ['head']),
  ...hays('ciso', 'Ciso (chief information security officer)', '>5 años', [5, 15], { madrid: [120000, 150000], barcelona: [120000, 150000], valencia: [80000, 110000], bilbao: [80000, 110000], sevilla: [80000, 110000] }, ['head']),
  ...hays('cloud_architect', 'Cloud architect', '<2 años', [0, 2], { madrid: [65000, 75000], barcelona: [65000, 75000], valencia: [50000, 60000], bilbao: [50000, 60000], sevilla: [50000, 60000] }),
  ...hays('cloud_architect', 'Cloud architect', '2-5 años', [2, 6], { madrid: [70000, 80000], barcelona: [70000, 80000], valencia: [60000, 70000], bilbao: [60000, 70000], sevilla: [60000, 70000] }),
  ...hays('cloud_architect', 'Cloud architect', '>5 años', [5, 15], { madrid: [80000, 100000], barcelona: [80000, 100000], valencia: [70000, 80000], bilbao: [70000, 80000], sevilla: [70000, 80000] }),
  ...hays('cloud_engineer', 'Cloud engineer', '<2 años', [0, 2], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [35000, 45000] }),
  ...hays('cloud_engineer', 'Cloud engineer', '2-5 años', [2, 6], { madrid: [50000, 65000], barcelona: [50000, 65000], valencia: [50000, 65000], bilbao: [50000, 65000], sevilla: [45000, 60000] }),
  ...hays('cloud_engineer', 'Cloud engineer', '>5 años', [5, 15], { madrid: [60000, 80000], barcelona: [60000, 80000], valencia: [60000, 80000], bilbao: [60000, 80000], sevilla: [55000, 70000] }),
  ...hays('comms_director', 'Director/a de comunicación', '>5 años', [5, 15], { madrid: [55000, 75000], barcelona: [55000, 70000], valencia: [48000, 52000], bilbao: [45000, 55000], sevilla: [45000, 48000] }, ['head']),
  ...hays('comms_manager', 'Communications manager', '2-5 años', [2, 6], { madrid: [40000, 45000], barcelona: [40000, 45000], valencia: [40000, 50000], bilbao: [40000, 45000], sevilla: [40000, 45000] }),
  ...hays('comms_technician', 'Técnico/a de comunicación', '2-5 años', [2, 6], { madrid: [25000, 35000], barcelona: [27000, 30000], valencia: [25000, 30000], bilbao: [25000, 30000], sevilla: [24000, 28000] }),
  ...hays('community_manager', 'Community manager', '2-5 años', [2, 6], { madrid: [28000, 33000], barcelona: [28000, 33000], valencia: [28000, 33000], bilbao: [28000, 33000], sevilla: [28000, 33000] }),
  ...hays('content_manager', 'Content manager', '3-6 años', [3, 7], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('content_specialist', 'Content specialist', '2-3 años', [2, 4], { madrid: [30000, 40000], barcelona: [30000, 40000], valencia: [30000, 40000], bilbao: [30000, 40000], sevilla: [30000, 40000] }),
  ...hays('copywriter', 'Creative copywriter', '2-3 años', [2, 4], { madrid: [28000, 35000], barcelona: [28000, 35000], valencia: [28000, 35000], bilbao: [28000, 35000], sevilla: [28000, 35000] }),
  ...hays('crm_manager', 'Crm manager', '3-6 años', [3, 7], { madrid: [45000, 65000], barcelona: [45000, 65000], valencia: [45000, 65000], bilbao: [45000, 65000], sevilla: [45000, 65000] }),
  ...hays('cto', 'Cto (chief technical officer)', '<2 años', [0, 2], { madrid: [100000, 120000], barcelona: [100000, 120000], valencia: [80000, 100000], bilbao: [80000, 100000], sevilla: [80000, 100000] }, ['head']),
  ...hays('cto', 'Cto (chief technical officer)', '2-5 años', [2, 6], { madrid: [120000, 160000], barcelona: [120000, 160000], valencia: [100000, 120000], bilbao: [100000, 120000], sevilla: [100000, 120000] }, ['head']),
  ...hays('cto', 'Cto (chief technical officer)', '>5 años', [5, 15], { madrid: [160000, 200000], barcelona: [160000, 200000], valencia: [120000, 150000], bilbao: [120000, 150000], sevilla: [120000, 150000] }, ['head']),
  ...hays('data_analyst', 'Data analyst', '<2 años', [0, 2], { madrid: [35000, 40000], barcelona: [35000, 40000], valencia: [30000, 40000], bilbao: [30000, 38000], sevilla: [30000, 40000] }),
  ...hays('data_analyst', 'Data analyst', '2-5 años', [2, 6], { madrid: [40000, 55000], barcelona: [40000, 55000], valencia: [35000, 45000], bilbao: [40000, 50000], sevilla: [40000, 45000] }),
  ...hays('data_analyst', 'Data analyst', '>5 años', [5, 15], { madrid: [55000, 70000], barcelona: [55000, 70000], valencia: [45000, 55000], bilbao: [50000, 60000], sevilla: [45000, 55000] }),
  manfred('data_analyst', 'Data Analyst', '<2 años', [0, 2], [20000, 25000]),
  manfred('data_analyst', 'Data Analyst', '2-5 años', [2, 6], [26000, 35000]),
  manfred('data_analyst', 'Data Analyst', '5-10 años', [5, 11], [36000, 42000]),
  manfred('data_analyst', 'Data Analyst', '>10 años', [10, 20], [43000, 50000]),
  ...hays('data_architect', 'Data architect', '<2 años', [0, 2], { madrid: [70000, 80000], barcelona: [70000, 80000], valencia: [50000, 60000], bilbao: [50000, 60000], sevilla: [50000, 60000] }),
  ...hays('data_architect', 'Data architect', '2-5 años', [2, 6], { madrid: [80000, 90000], barcelona: [80000, 90000], valencia: [60000, 80000], bilbao: [60000, 80000], sevilla: [60000, 80000] }),
  ...hays('data_architect', 'Data architect', '>5 años', [5, 15], { madrid: [90000, 110000], barcelona: [90000, 110000], valencia: [80000, 100000], bilbao: [80000, 100000], sevilla: [80000, 100000] }),
  manfred('data_architect', 'Data Architect', '2-5 años', [2, 6], [40000, 55000]),
  manfred('data_architect', 'Data Architect', '5-10 años', [5, 11], [56000, 75000]),
  manfred('data_architect', 'Data Architect', '>10 años', [10, 20], [75000, 100000]),
  ...hays('data_engineer', 'Data engineer', '<2 años', [0, 2], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [35000, 45000], bilbao: [30000, 35000], sevilla: [35000, 45000] }),
  ...hays('data_engineer', 'Data engineer', '2-5 años', [2, 6], { madrid: [55000, 70000], barcelona: [55000, 70000], valencia: [45000, 55000], bilbao: [45000, 55000], sevilla: [45000, 55000] }),
  ...hays('data_engineer', 'Data engineer', '>5 años', [5, 15], { madrid: [70000, 90000], barcelona: [70000, 90000], valencia: [55000, 75000], bilbao: [55000, 75000], sevilla: [55000, 75000] }),
  manfred('data_engineer', 'Data Engineer', '<2 años', [0, 2], [25000, 35000]),
  manfred('data_engineer', 'Data Engineer', '2-5 años', [2, 6], [36000, 45000]),
  manfred('data_engineer', 'Data Engineer', '5-10 años', [5, 11], [46000, 60000]),
  manfred('data_engineer', 'Data Engineer', '>10 años', [10, 20], [61000, 80000]),
  ...hays('data_scientist', 'Data scientist', '<2 años', [0, 2], { madrid: [35000, 50000], barcelona: [35000, 50000], valencia: [35000, 45000], bilbao: [30000, 40000], sevilla: [30000, 40000] }),
  ...hays('data_scientist', 'Data scientist', '2-5 años', [2, 6], { madrid: [45000, 60000], barcelona: [45000, 60000], valencia: [45000, 60000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('data_scientist', 'Data scientist', '>5 años', [5, 15], { madrid: [60000, 80000], barcelona: [60000, 80000], valencia: [65000, 75000], bilbao: [50000, 65000], sevilla: [50000, 65000] }),
  manfred('data_scientist', 'Data Scientist', '<2 años', [0, 2], [25000, 35000]),
  manfred('data_scientist', 'Data Scientist', '2-5 años', [2, 6], [36000, 50000]),
  manfred('data_scientist', 'Data Scientist', '5-10 años', [5, 11], [51000, 70000]),
  manfred('data_scientist', 'Data Scientist', '>10 años', [10, 20], [71000, 100000]),
  ...hays('devops', 'Devops engineer', '<2 años', [0, 2], { madrid: [45000, 55000], barcelona: [45000, 55000], valencia: [45000, 55000], bilbao: [35000, 50000], sevilla: [35000, 50000] }),
  ...hays('devops', 'Devops engineer', '2-5 años', [2, 6], { madrid: [55000, 70000], barcelona: [55000, 70000], valencia: [50000, 70000], bilbao: [45000, 60000], sevilla: [45000, 60000] }),
  ...hays('devops', 'Devops engineer', '>5 años', [5, 15], { madrid: [70000, 100000], barcelona: [70000, 100000], valencia: [65000, 80000], bilbao: [55000, 75000], sevilla: [55000, 75000] }),
  manfred('devops', 'SRE/DevOps', '<2 años', [0, 2], [25000, 35000]),
  manfred('devops', 'SRE/DevOps', '2-5 años', [2, 6], [36000, 45000]),
  manfred('devops', 'SRE/DevOps', '5-10 años', [5, 11], [46000, 60000]),
  manfred('devops', 'SRE/DevOps', '>10 años', [10, 20], [61000, 80000]),
  ...hays('digital_analyst', 'Digital analyst', '2-5 años', [2, 6], { madrid: [45000, 60000], barcelona: [45000, 60000], valencia: [40000, 55000], bilbao: [45000, 55000], sevilla: [45000, 55000] }),
  ...hays('digital_marketing_manager', 'Digital marketing manager', '3-6 años', [3, 7], { madrid: [80000, 90000], barcelona: [80000, 90000], valencia: [80000, 90000], bilbao: [80000, 90000], sevilla: [80000, 90000] }),
  ...hays('digital_marketing_specialist', 'Digital marketing specialist', '2-5 años', [2, 6], { madrid: [35000, 45000], barcelona: [35000, 45000], valencia: [35000, 45000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  ...hays('dotnet_developer', '.net developer', '<2 años', [0, 2], { madrid: [30000, 36000], barcelona: [28000, 36000], valencia: [22000, 32000], bilbao: [23000, 30000], sevilla: [23000, 33000] }),
  ...hays('dotnet_developer', '.net developer', '2-5 años', [2, 6], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [30000, 42000], bilbao: [32000, 42000], sevilla: [32000, 42000] }),
  ...hays('dotnet_developer', '.net developer', '>5 años', [5, 15], { madrid: [45000, 60000], barcelona: [53000, 63000], valencia: [29000, 51000], bilbao: [42000, 55000], sevilla: [42000, 50000] }),
  ...hays('email_marketing', 'Email marketing specialist', '2-3 años', [2, 4], { madrid: [30000, 35000], barcelona: [30000, 35000], valencia: [30000, 35000], bilbao: [30000, 35000], sevilla: [30000, 35000] }),
  ...hays('engineering_manager', 'Development manager', '<2 años', [0, 2], { madrid: [60000, 70000], barcelona: [60000, 70000], valencia: [50000, 60000], bilbao: [50000, 60000], sevilla: [50000, 60000] }),
  ...hays('engineering_manager', 'Development manager', '2-5 años', [2, 6], { madrid: [70000, 80000], barcelona: [70000, 80000], valencia: [60000, 70000], bilbao: [60000, 70000], sevilla: [60000, 70000] }),
  ...hays('engineering_manager', 'Development manager', '>5 años', [5, 15], { madrid: [80000, 90000], barcelona: [80000, 90000], valencia: [70000, 75000], bilbao: [70000, 75000], sevilla: [70000, 75000] }),
  manfred('engineering_manager', 'Engineering Manager', '5-10 años', [5, 11], [60000, 85000]),
  manfred('engineering_manager', 'Engineering Manager', '>10 años', [10, 20], [86000, 110000]),
  ...hays('frontend', 'Front-end developer', '<2 años', [0, 2], { madrid: [30000, 36000], barcelona: [32000, 38000], valencia: [24000, 48000], bilbao: [27000, 32000], sevilla: [25000, 33000] }),
  ...hays('frontend', 'Front-end developer', '2-5 años', [2, 6], { madrid: [38000, 48000], barcelona: [41000, 57000], valencia: [36000, 58000], bilbao: [35000, 40000], sevilla: [35000, 40000] }),
  ...hays('frontend', 'Front-end developer', '>5 años', [5, 15], { madrid: [50000, 60000], barcelona: [58000, 70000], valencia: [38000, 65000], bilbao: [40000, 55000], sevilla: [40000, 55000] }),
  manfred('frontend', 'Frontend Engineer', '<2 años', [0, 2], [20000, 30000]),
  manfred('frontend', 'Frontend Engineer', '2-5 años', [2, 6], [31000, 35000]),
  manfred('frontend', 'Frontend Engineer', '5-10 años', [5, 11], [35000, 40000]),
  manfred('frontend', 'Frontend Engineer', '>10 años', [10, 20], [40000, 50000]),
  manfred('fullstack', 'Full-Stack Engineer', '<2 años', [0, 2], [20000, 30000]),
  manfred('fullstack', 'Full-Stack Engineer', '2-5 años', [2, 6], [31000, 40000]),
  manfred('fullstack', 'Full-Stack Engineer', '5-10 años', [5, 11], [41000, 50000]),
  manfred('fullstack', 'Full-Stack Engineer', '>10 años', [10, 20], [51000, 60000]),
  ...hays('golang_developer', 'Golang developer', '<2 años', [0, 2], { madrid: [42000, 52000], barcelona: [40000, 50000], valencia: [24000, 50000], bilbao: [38000, 42000], sevilla: [25000, 35000] }),
  ...hays('golang_developer', 'Golang developer', '2-5 años', [2, 6], { madrid: [50000, 70000], barcelona: [48000, 65000], valencia: [32000, 55000], bilbao: [42000, 52000], sevilla: [30000, 44000] }),
  ...hays('golang_developer', 'Golang developer', '>5 años', [5, 15], { madrid: [70000, 100000], barcelona: [65000, 75000], valencia: [40000, 70000], bilbao: [52000, 60000], sevilla: [45000, 60000] }),
  ...hays('graphic_designer', 'Graphic designer', '2-3 años', [2, 4], { madrid: [30000, 35000], barcelona: [30000, 35000], valencia: [30000, 35000], bilbao: [30000, 35000], sevilla: [30000, 35000] }),
  ...hays('growth_manager', 'Growth manager', '3-6 años', [3, 7], { madrid: [55000, 75000], barcelona: [55000, 75000], valencia: [45000, 75000], bilbao: [55000, 75000], sevilla: [55000, 75000] }),
  ...hays('head_of_design', 'Head of design', '>5 años', [5, 15], { madrid: [60000, 80000], barcelona: [60000, 80000], valencia: [60000, 80000], bilbao: [60000, 80000], sevilla: [60000, 80000] }, ['lead', 'head']),
  manfred('head_of_engineering', 'CTO/Head of Engineering', '5-10 años', [5, 11], [55000, 90000], ['head']),
  manfred('head_of_engineering', 'CTO/Head of Engineering', '>10 años', [10, 20], [91000, 140000], ['head']),
  ...hays('head_of_partnerships', 'Head of partnerships', '4-6 años', [4, 7], { madrid: [65000, 75000], barcelona: [65000, 75000], valencia: [65000, 75000], bilbao: [65000, 75000], sevilla: [65000, 75000] }, ['lead', 'head']),
  ...hays('head_of_product', 'Head of digital product', '>5 años', [5, 15], { madrid: [80000, 100000], barcelona: [80000, 100000], valencia: [70000, 95000], bilbao: [80000, 100000], sevilla: [80000, 100000] }, ['head']),
  ...hays('influencer_marketing', 'Influencer marketing specialist (e-pr)', '2-3 años', [2, 4], { madrid: [35000, 55000], barcelona: [35000, 55000], valencia: [35000, 55000], bilbao: [35000, 55000], sevilla: [35000, 55000] }),
  ...hays('java_developer', 'Java / j2ee developer', '<2 años', [0, 2], { madrid: [30000, 36000], barcelona: [28000, 36000], valencia: [26000, 30000], bilbao: [20000, 27000], sevilla: [23000, 33000] }),
  ...hays('java_developer', 'Java / j2ee developer', '2-5 años', [2, 6], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [25000, 48000], bilbao: [28000, 38000], sevilla: [32000, 42000] }),
  ...hays('java_developer', 'Java / j2ee developer', '>5 años', [5, 15], { madrid: [45000, 60000], barcelona: [53000, 63000], valencia: [30000, 60000], bilbao: [38000, 45000], sevilla: [42000, 50000] }),
  ...hays('marketing_assistant', 'Marketing assistant', '2-5 años', [2, 6], { madrid: [24000, 30000], barcelona: [24000, 31500], valencia: [22000, 27000], bilbao: [20000, 30000], sevilla: [22000, 26000] }),
  ...hays('marketing_automation', 'Automation specialist (crm)', '3 años', [3, 4], { madrid: [35000, 40000], barcelona: [35000, 40000], valencia: [35000, 40000], bilbao: [35000, 40000], sevilla: [35000, 40000] }),
  ...hays('marketing_director', 'Director/a de marketing', '5-10 años', [5, 11], { madrid: [60000, 80000], barcelona: [60000, 70000], valencia: [55000, 65000], bilbao: [65000, 70000], sevilla: [50000, 65000] }, ['head']),
  ...hays('marketing_director', 'Director/a de marketing', '>10 años', [10, 20], { madrid: [83000, 98000], barcelona: [75500, 105000], valencia: [65000, 85000], bilbao: [60000, 80000], sevilla: [58000, 85000] }, ['head']),
  ...hays('marketing_manager', 'Marketing manager', '>5 años', [5, 15], { madrid: [50000, 60000], barcelona: [46000, 60000], valencia: [50000, 52000], bilbao: [45000, 55000], sevilla: [45000, 50000] }),
  ...hays('marketing_technician', 'Técnico/a de marketing', '2-5 años', [2, 6], { madrid: [28000, 35000], barcelona: [28000, 35000], valencia: [25000, 30000], bilbao: [25000, 35000], sevilla: [23000, 25000] }),
  ...hays('martech_director', 'Martech director', '>10 años', [10, 20], { madrid: [70000, 90000], barcelona: [70000, 90000], valencia: [60000, 70000], bilbao: [65000, 80000], sevilla: [60000, 70000] }, ['lead', 'head']),
  ...hays('martech_specialist', 'Martech specialist', '3-5 años', [3, 6], { madrid: [45000, 60000], barcelona: [45000, 60000], valencia: [40000, 50000], bilbao: [40000, 60000], sevilla: [40000, 50000] }),
  ...hays('ml_engineer', 'Machine learning engineer / ai engineer', '<2 años', [0, 2], { madrid: [45000, 55000], barcelona: [45000, 55000], valencia: [45000, 55000], bilbao: [45000, 55000], sevilla: [45000, 50000] }),
  ...hays('ml_engineer', 'Machine learning engineer / ai engineer', '2-5 años', [2, 6], { madrid: [50000, 65000], barcelona: [50000, 65000], valencia: [50000, 65000], bilbao: [50000, 65000], sevilla: [50000, 60000] }),
  ...hays('ml_engineer', 'Machine learning engineer / ai engineer', '>5 años', [5, 15], { madrid: [70000, 90000], barcelona: [70000, 90000], valencia: [70000, 90000], bilbao: [70000, 90000], sevilla: [70000, 80000] }),
  manfred('ml_engineer', 'AI Engineer', '<2 años', [0, 2], [25000, 35000]),
  manfred('ml_engineer', 'AI Engineer', '2-5 años', [2, 6], [36000, 50000]),
  manfred('ml_engineer', 'AI Engineer', '5-10 años', [5, 11], [51000, 70000]),
  manfred('ml_engineer', 'AI Engineer', '>10 años', [10, 20], [71000, 90000]),
  manfred('mobile', 'Mobile', '<2 años', [0, 2], [20000, 30000]),
  manfred('mobile', 'Mobile', '2-5 años', [2, 6], [31000, 40000]),
  manfred('mobile', 'Mobile', '5-10 años', [5, 11], [41000, 45000]),
  manfred('mobile', 'Mobile', '>10 años', [10, 20], [46000, 50000]),
  ...hays('mobile_android', 'Mobile android', '<2 años', [0, 2], { madrid: [30000, 35000], barcelona: [33000, 38000], valencia: [23000, 43000], bilbao: [28000, 33000], sevilla: [26000, 32000] }),
  ...hays('mobile_android', 'Mobile android', '2-5 años', [2, 6], { madrid: [35000, 50000], barcelona: [42000, 55000], valencia: [30000, 47000], bilbao: [33000, 45000], sevilla: [30000, 44000] }),
  ...hays('mobile_android', 'Mobile android', '>5 años', [5, 15], { madrid: [50000, 65000], barcelona: [55000, 70000], valencia: [34000, 60000], bilbao: [45000, 55000], sevilla: [40000, 53000] }),
  ...hays('mobile_ios', 'Mobile ios / flutter', '<2 años', [0, 2], { madrid: [30000, 38000], barcelona: [33000, 40000], valencia: [23000, 47000], bilbao: [30000, 35000], sevilla: [25000, 35000] }),
  ...hays('mobile_ios', 'Mobile ios / flutter', '2-5 años', [2, 6], { madrid: [38000, 45000], barcelona: [40000, 55000], valencia: [34000, 56000], bilbao: [35000, 45000], sevilla: [32000, 42000] }),
  ...hays('mobile_ios', 'Mobile ios / flutter', '>5 años', [5, 15], { madrid: [45000, 60000], barcelona: [55000, 72000], valencia: [40000, 70000], bilbao: [45000, 55000], sevilla: [45000, 55000] }),
  ...hays('node_developer', 'Node.js developer', '<2 años', [0, 2], { madrid: [30000, 38000], barcelona: [32000, 38000], valencia: [23000, 43000], bilbao: [27000, 32000], sevilla: [27000, 32000] }),
  ...hays('node_developer', 'Node.js developer', '2-5 años', [2, 6], { madrid: [38000, 55000], barcelona: [42000, 62000], valencia: [28000, 56000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  ...hays('node_developer', 'Node.js developer', '>5 años', [5, 15], { madrid: [55000, 65000], barcelona: [58000, 75000], valencia: [40000, 64000], bilbao: [45000, 55000], sevilla: [45000, 55000] }),
  ...hays('paid_media_director', 'Paid media director', '3-6 años', [3, 7], { madrid: [70000, 80000], barcelona: [70000, 80000], valencia: [70000, 80000], bilbao: [70000, 80000], sevilla: [70000, 80000] }, ['lead', 'head']),
  ...hays('pentester', 'Pentesting / ethical hacker', '<2 años', [0, 2], { madrid: [38000, 42000], barcelona: [38000, 42000], valencia: [38000, 42000], bilbao: [38000, 42000], sevilla: [38000, 42000] }),
  ...hays('pentester', 'Pentesting / ethical hacker', '2-5 años', [2, 6], { madrid: [50000, 60000], barcelona: [50000, 60000], valencia: [50000, 60000], bilbao: [50000, 60000], sevilla: [50000, 60000] }),
  ...hays('pentester', 'Pentesting / ethical hacker', '>5 años', [5, 15], { madrid: [68000, 75000], barcelona: [68000, 75000], valencia: [68000, 75000], bilbao: [68000, 75000], sevilla: [68000, 75000] }),
  ...hays('performance_manager', 'Performance manager', '3-5 años', [3, 6], { madrid: [50000, 70000], barcelona: [50000, 70000], valencia: [50000, 70000], bilbao: [50000, 70000], sevilla: [50000, 70000] }),
  ...hays('performance_specialist', 'Performance specialist', '3-5 años', [3, 6], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('php_developer', 'Php developer', '<2 años', [0, 2], { madrid: [24000, 25000], barcelona: [28000, 32000], valencia: [19000, 35000], bilbao: [20000, 28000], sevilla: [20000, 30000] }),
  ...hays('php_developer', 'Php developer', '2-5 años', [2, 6], { madrid: [35000, 43000], barcelona: [37000, 48000], valencia: [22000, 44000], bilbao: [28000, 38000], sevilla: [26000, 38000] }),
  ...hays('php_developer', 'Php developer', '>5 años', [5, 15], { madrid: [40000, 50000], barcelona: [50000, 60000], valencia: [23000, 53000], bilbao: [38000, 45000], sevilla: [32000, 45000] }),
  ...hays('pr_events_manager', 'Pr & events manager', '2-5 años', [2, 6], { madrid: [30000, 40000], barcelona: [30000, 40000], valencia: [30000, 45000], bilbao: [30000, 40000], sevilla: [30000, 40000] }),
  ...hays('presales_engineer', 'Presales engineer', '<2 años', [0, 2], { madrid: [38850, 45150], barcelona: [38850, 45150], valencia: [38325, 44625], bilbao: [38850, 45150], sevilla: [38850, 45150] }),
  ...hays('presales_engineer', 'Presales engineer', '2-5 años', [2, 6], { madrid: [49350, 55650], barcelona: [49350, 55650], valencia: [46725, 53025], bilbao: [49350, 55650], sevilla: [49350, 55650] }),
  ...hays('presales_engineer', 'Presales engineer', '5-10 años', [5, 11], { madrid: [59850, 66150], barcelona: [59850, 66150], valencia: [57750, 64050], bilbao: [59850, 66150], sevilla: [59850, 66150] }),
  ...hays('presales_manager', 'Presales manager', '<2 años', [0, 2], { madrid: [59850, 66150], barcelona: [59850, 66150], valencia: [43575, 49875], bilbao: [59850, 66150], sevilla: [44100, 50400] }),
  ...hays('presales_manager', 'Presales manager', '2-5 años', [2, 6], { madrid: [70350, 76650], barcelona: [70350, 76650], valencia: [48825, 55125], bilbao: [70350, 76650], sevilla: [49350, 55650] }),
  ...hays('presales_manager', 'Presales manager', '>5 años', [5, 15], { madrid: [86100, 92400], barcelona: [86100, 92400], valencia: [54075, 60375], bilbao: [83475, 89775], sevilla: [51975, 58275] }),
  ...hays('product_designer', 'Product designer', '>5 años', [5, 15], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  manfred('product_designer', 'Product Designer', '<2 años', [0, 2], [20000, 25000]),
  manfred('product_designer', 'Product Designer', '2-5 años', [2, 6], [26000, 30000]),
  manfred('product_designer', 'Product Designer', '5-10 años', [5, 11], [31000, 40000]),
  manfred('product_designer', 'Product Designer', '>10 años', [10, 20], [41000, 50000]),
  ...hays('product_manager', 'Product manager (software / saas / mobile)', '<2 años', [0, 2], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [30000, 40000], bilbao: [30000, 40000], sevilla: [30000, 40000] }),
  ...hays('product_manager', 'Product manager (software / saas / mobile)', '2-5 años', [2, 6], { madrid: [50000, 60000], barcelona: [50000, 60000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('product_manager', 'Product manager (software / saas / mobile)', '>5 años', [5, 15], { madrid: [60000, 70000], barcelona: [60000, 70000], valencia: [50000, 60000], bilbao: [50000, 60000], sevilla: [50000, 60000] }),
  manfred('product_manager', 'Product Manager', '2-5 años', [2, 6], [31000, 45000]),
  manfred('product_manager', 'Product Manager', '5-10 años', [5, 11], [46000, 55000]),
  manfred('product_manager', 'Product Manager', '>10 años', [10, 20], [55000, 80000]),
  ...hays('product_owner', 'Product owner (software / saas / mobile)', '<2 años', [0, 2], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [30000, 40000], bilbao: [30000, 40000], sevilla: [30000, 40000] }),
  ...hays('product_owner', 'Product owner (software / saas / mobile)', '2-5 años', [2, 6], { madrid: [50000, 57000], barcelona: [50000, 60000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('product_owner', 'Product owner (software / saas / mobile)', '>5 años', [5, 15], { madrid: [60000, 67000], barcelona: [60000, 70000], valencia: [50000, 60000], bilbao: [50000, 60000], sevilla: [50000, 60000] }),
  ...hays('python_developer', 'Python developer', '<2 años', [0, 2], { madrid: [33000, 38000], barcelona: [32000, 38000], valencia: [22000, 48000], bilbao: [27000, 32000], sevilla: [28000, 37000] }),
  ...hays('python_developer', 'Python developer', '2-5 años', [2, 6], { madrid: [40000, 55000], barcelona: [45000, 53000], valencia: [30000, 56000], bilbao: [30000, 45000], sevilla: [35000, 46000] }),
  ...hays('python_developer', 'Python developer', '>5 años', [5, 15], { madrid: [45000, 70000], barcelona: [55000, 63000], valencia: [38000, 65000], bilbao: [45000, 60000], sevilla: [40000, 50000] }),
  ...hays('qa_automation', 'Qa automation', '<2 años', [0, 2], { madrid: [36000, 42000], barcelona: [42000, 48000], valencia: [32000, 42000], bilbao: [32000, 38000], sevilla: [32000, 45000] }),
  ...hays('qa_automation', 'Qa automation', '2-5 años', [2, 6], { madrid: [40000, 52000], barcelona: [48000, 58000], valencia: [38000, 53000], bilbao: [38000, 45000], sevilla: [40000, 48000] }),
  ...hays('qa_automation', 'Qa automation', '>5 años', [5, 15], { madrid: [48000, 65000], barcelona: [57000, 67000], valencia: [42000, 70000], bilbao: [45000, 52000], sevilla: [45000, 55000] }),
  ...hays('qa_lead', 'Qa test lead', '<2 años', [0, 2], { madrid: [35000, 45000], barcelona: [35000, 45000], valencia: [30000, 40000], bilbao: [30000, 40000], sevilla: [30000, 40000] }),
  ...hays('qa_lead', 'Qa test lead', '2-5 años', [2, 6], { madrid: [45000, 50000], barcelona: [45000, 50000], valencia: [40000, 45000], bilbao: [40000, 45000], sevilla: [40000, 45000] }),
  ...hays('qa_lead', 'Qa test lead', '>5 años', [5, 15], { madrid: [55000, 60000], barcelona: [55000, 60000], valencia: [45000, 50000], bilbao: [45000, 50000], sevilla: [45000, 50000] }),
  ...hays('qa_manager', 'Qa manager', '<2 años', [0, 2], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [35000, 45000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  ...hays('qa_manager', 'Qa manager', '2-5 años', [2, 6], { madrid: [50000, 55000], barcelona: [50000, 55000], valencia: [45000, 50000], bilbao: [45000, 50000], sevilla: [45000, 50000] }),
  ...hays('qa_manager', 'Qa manager', '>5 años', [5, 15], { madrid: [55000, 65000], barcelona: [55000, 65000], valencia: [50000, 55000], bilbao: [50000, 55000], sevilla: [50000, 55000] }),
  ...hays('qa_tester', 'Qa tester', '<2 años', [0, 2], { madrid: [28000, 32000], barcelona: [25000, 35000], valencia: [22000, 36000], bilbao: [21000, 27000], sevilla: [23000, 28000] }),
  ...hays('qa_tester', 'Qa tester', '2-5 años', [2, 6], { madrid: [32000, 42000], barcelona: [35000, 45000], valencia: [25000, 43000], bilbao: [30000, 35000], sevilla: [28000, 40000] }),
  ...hays('qa_tester', 'Qa tester', '>5 años', [5, 15], { madrid: [40000, 50000], barcelona: [45000, 52000], valencia: [28000, 50000], bilbao: [35000, 40000], sevilla: [35000, 45000] }),
  manfred('qa_tester', 'QA & Testing', '<2 años', [0, 2], [20000, 25000]),
  manfred('qa_tester', 'QA & Testing', '2-5 años', [2, 6], [26000, 32000]),
  manfred('qa_tester', 'QA & Testing', '5-10 años', [5, 11], [33000, 40000]),
  manfred('qa_tester', 'QA & Testing', '>10 años', [10, 20], [41000, 45000]),
  ...hays('ruby_developer', 'Ruby on rails developer', '<2 años', [0, 2], { madrid: [34000, 40000], barcelona: [35000, 42000], valencia: [22000, 48000], bilbao: [28000, 32000], sevilla: [26000, 34000] }),
  ...hays('ruby_developer', 'Ruby on rails developer', '2-5 años', [2, 6], { madrid: [37000, 50000], barcelona: [43000, 55000], valencia: [30000, 50000], bilbao: [32000, 38000], sevilla: [30000, 40000] }),
  ...hays('ruby_developer', 'Ruby on rails developer', '>5 años', [5, 15], { madrid: [50000, 70000], barcelona: [55000, 65000], valencia: [36000, 64000], bilbao: [38000, 42000], sevilla: [35000, 45000] }),
  ...hays('security_analyst', 'Cybersecurity analyst', '<2 años', [0, 2], { madrid: [39000, 43000], barcelona: [39000, 43000], valencia: [39000, 43000], bilbao: [39000, 43000], sevilla: [39000, 43000] }),
  ...hays('security_analyst', 'Cybersecurity analyst', '2-5 años', [2, 6], { madrid: [48000, 54000], barcelona: [48000, 54000], valencia: [48000, 54000], bilbao: [48000, 54000], sevilla: [48000, 54000] }),
  ...hays('security_analyst', 'Cybersecurity analyst', '>5 años', [5, 15], { madrid: [62000, 67000], barcelona: [62000, 67000], valencia: [62000, 67000], bilbao: [62000, 67000], sevilla: [62000, 67000] }),
  ...hays('security_architect', 'Cybersecurity architect', '<2 años', [0, 2], { madrid: [48000, 55000], barcelona: [48000, 55000], valencia: [48000, 55000], bilbao: [48000, 55000], sevilla: [48000, 55000] }),
  ...hays('security_architect', 'Cybersecurity architect', '2-5 años', [2, 6], { madrid: [64000, 70000], barcelona: [64000, 70000], valencia: [64000, 70000], bilbao: [64000, 70000], sevilla: [64000, 70000] }),
  ...hays('security_architect', 'Cybersecurity architect', '>5 años', [5, 15], { madrid: [85000, 95000], barcelona: [85000, 95000], valencia: [85000, 95000], bilbao: [85000, 95000], sevilla: [85000, 95000] }),
  ...hays('security_engineer', 'Cybersecurity engineer', '<2 años', [0, 2], { madrid: [43000, 48000], barcelona: [43000, 48000], valencia: [43000, 48000], bilbao: [43000, 48000], sevilla: [43000, 48000] }),
  ...hays('security_engineer', 'Cybersecurity engineer', '2-5 años', [2, 6], { madrid: [53000, 58000], barcelona: [53000, 58000], valencia: [53000, 58000], bilbao: [53000, 58000], sevilla: [53000, 58000] }),
  ...hays('security_engineer', 'Cybersecurity engineer', '>5 años', [5, 15], { madrid: [75000, 82000], barcelona: [75000, 82000], valencia: [75000, 82000], bilbao: [75000, 82000], sevilla: [75000, 82000] }),
  manfred('security_engineer', 'Security/Cybersecurity Engineer', '<2 años', [0, 2], [25000, 30000]),
  manfred('security_engineer', 'Security/Cybersecurity Engineer', '2-5 años', [2, 6], [31000, 40000]),
  manfred('security_engineer', 'Security/Cybersecurity Engineer', '5-10 años', [5, 11], [41000, 55000]),
  manfred('security_engineer', 'Security/Cybersecurity Engineer', '>10 años', [10, 20], [56000, 80000]),
  ...hays('sem_manager', 'Sem manager', '3-6 años', [3, 7], { madrid: [40000, 60000], barcelona: [40000, 60000], valencia: [40000, 70000], bilbao: [40000, 60000], sevilla: [40000, 60000] }),
  ...hays('sem_specialist', 'Sem & ppc specialist', '2-3 años', [2, 4], { madrid: [35000, 45000], barcelona: [35000, 45000], valencia: [35000, 50000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  ...hays('seo_manager', 'Seo manager', '3-6 años', [3, 7], { madrid: [40000, 60000], barcelona: [40000, 60000], valencia: [40000, 60000], bilbao: [40000, 60000], sevilla: [40000, 60000] }),
  ...hays('seo_specialist', 'Seo specialist', '3 años', [3, 4], { madrid: [35000, 40000], barcelona: [35000, 40000], valencia: [35000, 40000], bilbao: [35000, 40000], sevilla: [35000, 40000] }),
  ...hays('social_media_manager', 'Social media manager', '5 años', [5, 6], { madrid: [45000, 55000], barcelona: [45000, 55000], valencia: [40000, 60000], bilbao: [45000, 55000], sevilla: [45000, 55000] }),
  ...hays('software_architect', 'Software architect', '<2 años', [0, 2], { madrid: [60000, 75000], barcelona: [60000, 70000], valencia: [42000, 56000], bilbao: [44000, 50000], sevilla: [43000, 50000] }),
  ...hays('software_architect', 'Software architect', '2-5 años', [2, 6], { madrid: [70000, 90000], barcelona: [65000, 75000], valencia: [44000, 65000], bilbao: [50000, 55000], sevilla: [50000, 55000] }),
  ...hays('software_architect', 'Software architect', '>5 años', [5, 15], { madrid: [80000, 100000], barcelona: [68000, 78000], valencia: [50000, 75000], bilbao: [55000, 70000], sevilla: [50000, 70000] }),
  manfred('software_architect', 'Software Architect', '2-5 años', [2, 6], [40000, 50000]),
  manfred('software_architect', 'Software Architect', '5-10 años', [5, 11], [51000, 75000]),
  manfred('software_architect', 'Software Architect', '>10 años', [10, 20], [75000, 100000]),
  manfred('staff_engineer', 'Staff Engineer', '5-10 años', [5, 11], [65000, 85000], ['senior', 'lead', 'head']),
  manfred('staff_engineer', 'Staff Engineer', '>10 años', [10, 20], [86000, 120000], ['senior', 'lead', 'head']),
  manfred('sysadmin', 'SysAdmin', '<2 años', [0, 2], [20000, 25000]),
  manfred('sysadmin', 'SysAdmin', '2-5 años', [2, 6], [26000, 35000]),
  manfred('sysadmin', 'SysAdmin', '5-10 años', [5, 11], [36000, 45000]),
  manfred('sysadmin', 'SysAdmin', '>10 años', [10, 20], [46000, 50000]),
  ...hays('tech_lead', 'Team lead (sw development)', '<2 años', [0, 2], { madrid: [45000, 55000], barcelona: [45000, 55000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('tech_lead', 'Team lead (sw development)', '2-5 años', [2, 6], { madrid: [55000, 60000], barcelona: [55000, 60000], valencia: [50000, 55000], bilbao: [50000, 55000], sevilla: [50000, 55000] }),
  ...hays('tech_lead', 'Team lead (sw development)', '>5 años', [5, 15], { madrid: [60000, 65000], barcelona: [60000, 65000], valencia: [55000, 60000], bilbao: [55000, 60000], sevilla: [55000, 60000] }),
  manfred('tech_lead', 'Tech Lead', '2-5 años', [2, 6], [40000, 50000]),
  manfred('tech_lead', 'Tech Lead', '5-10 años', [5, 11], [51000, 65000]),
  manfred('tech_lead', 'Tech Lead', '>10 años', [10, 20], [65000, 80000]),
  ...hays('trade_marketing', 'Trade marketing manager', '<5 años', [0, 5], { madrid: [40000, 45000], barcelona: [40000, 45000], valencia: [37000, 42000], bilbao: [38000, 45000], sevilla: [35000, 40000] }),
  ...hays('trade_marketing', 'Trade marketing manager', '>5 años', [5, 15], { madrid: [45000, 60000], barcelona: [45000, 55000], valencia: [42000, 45000], bilbao: [45000, 55000], sevilla: [42000, 45000] }),
  ...hays('ui_designer', 'Ui designer', '3-5 años', [3, 6], { madrid: [35000, 45000], barcelona: [35000, 45000], valencia: [35000, 45000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  ...hays('user_acquisition_manager', 'User acquisition manager', '3-5 años', [3, 6], { madrid: [40000, 60000], barcelona: [40000, 60000], valencia: [40000, 60000], bilbao: [40000, 60000], sevilla: [40000, 60000] }),
  ...hays('ux_designer', 'Ux designer', '3-5 años', [3, 6], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [40000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('ux_researcher', 'Ux researcher', '3-5 años', [3, 6], { madrid: [35000, 45000], barcelona: [35000, 45000], valencia: [35000, 45000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  ...hays('ux_ui_designer', 'Ux/ui designer', '3-5 años', [3, 6], { madrid: [40000, 50000], barcelona: [40000, 50000], valencia: [35000, 50000], bilbao: [40000, 50000], sevilla: [40000, 50000] }),
  ...hays('ux_writer', 'Ux writer', '3-5 años', [3, 6], { madrid: [35000, 45000], barcelona: [35000, 45000], valencia: [35000, 45000], bilbao: [35000, 45000], sevilla: [35000, 45000] }),
  manfred('vp_engineering', 'VP of Engineering', '5-10 años', [5, 11], [75000, 110000], ['head']),
  manfred('vp_engineering', 'VP of Engineering', '>10 años', [10, 20], [110000, 150000], ['head']),
]

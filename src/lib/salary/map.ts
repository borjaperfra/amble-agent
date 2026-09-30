import { normaliseTitle } from '../sourcing/text'
import { cityAreaTerms, countryOf, placeOutsideEurope } from '../matching/places'
import type { Level, Place, Role } from './bands'

// Which row of the reference table (bands.ts) an offer belongs to: its role
// and level, from its title (and, for the level, the experience its text asks
// for), and the place in Spain it is done from. Plain rules, no model: an
// offer the rules cannot place gets no estimate, never a guess. None of this
// produces a figure: the figures are only the table's.

export interface OfferKey {
  role: Role
  level: Level
  place: Place
  // Where the level came from: the title says it, the text asks for years of
  // experience, or neither does (then the source's own bracket for the role
  // nearest the middle of the scale is taken, and the label says which).
  levelFrom: 'title' | 'experience' | 'default'
}

export type NoKey = 'role' | 'place'

// Titles are matched normalised (lowercase, no accents, anything but letters
// and digits turned into spaces), so every pattern is written that way. The
// first rule that matches wins, so the more specific come first: "product
// marketing manager" is marketing, not product management; "engineering
// manager" is management, not software; "content team lead" is content.
const ROLE_RULES: [Role, RegExp][] = [
  // Leading the function.
  ['cto', /\b(cto|chief technology officer|chief technical officer)\b/],
  ['ciso', /\b(ciso|chief information security officer)\b/],
  ['vp_engineering', /\b(vp|vice president)( of)? engineering\b/],
  ['head_of_engineering', /\b(head of engineering|director of engineering|engineering director|director de ingenieria)\b/],
  ['engineering_manager', /\b(engineering manager|manager engineering|software development manager|development manager|jefe de desarrollo|responsable de desarrollo)\b/],
  ['tech_lead', /\b((tech|technical|engineering|development|software|developer|backend|frontend|full ?stack) (team )?lead|lead (developer|engineer|software engineer|backend|frontend)|jefe de equipo de desarrollo|jefe de proyecto de desarrollo)\b/],
  ['staff_engineer', /\b(staff|principal) (software |backend |frontend |full ?stack |platform )?(engineer|developer)\b/],

  // Roles with no public Spanish source yet: placed, so they are counted, but
  // they get no estimate (bands.ts has no rows for them).
  ['devrel', /\b(developer advocate|developer advocacy|developer relations|devrel|dev rel|developer evangelist|technology evangelist|tech evangelist|developer community|developer experience)\b/],
  ['technical_writer', /\b(technical writer|tech writer|documentation (writer|engineer|specialist)|docs engineer|api writer|redactor tecnico|redactora tecnica)\b/],
  ['product_marketing', /\b(product marketing|product marketer|product marketeer|pmm|marketing de producto)\b/],

  ['presales_manager', /\b((pre ?sales|presales|solutions? engineering|solutions? consulting|preventa) (manager|director|lead)|head of (pre ?sales|presales|solutions))\b/],
  ['presales_engineer', /\b(solutions? engineer|sales engineer|pre ?sales|presales|solutions? consultant|customer engineer|preventa|solutions? architect|forward deployed engineer)\b/],

  ['pentester', /\b(pentest\w*|penetration tester|ethical hacker|red team|offensive security)\b/],
  ['security_architect', /\b(security architect|cybersecurity architect|arquitecto de seguridad|arquitecta de seguridad)\b/],
  ['security_analyst', /\b(security analyst|cybersecurity analyst|soc analyst|analista de (ciber)?seguridad|threat (intelligence|analyst)|security operations)\b/],
  ['security_engineer', /\b(security engineer|cybersecurity|cyber security|ciberseguridad|appsec|application security|devsecops|product security|cloud security|security specialist)\b/],

  ['cloud_architect', /\b(cloud architect|arquitecto cloud|arquitecta cloud|infrastructure architect)\b/],
  ['devops', /\b(devops|sre|site reliability|platform engineer|infrastructure engineer|kubernetes)\b/],
  ['cloud_engineer', /\b(cloud engineer|ingeniero cloud|ingeniera cloud|cloud developer)\b/],
  ['sysadmin', /\b(system administrator|systems administrator|sysadmin|administrador de sistemas|administradora de sistemas|systems? engineer)\b/],

  ['data_architect', /\b(data architect|arquitecto de datos|arquitecta de datos)\b/],
  ['data_engineer', /\b(data engineer|analytics engineer|big data|ingeniero de datos|ingeniera de datos|etl developer|data platform engineer)\b/],
  ['ml_engineer', /\b(machine learning|ml engineer|mlops|ai engineer|ia engineer|llm engineer|genai engineer|deep learning|computer vision|nlp engineer|applied scientist|ai developer|ai researcher)\b/],
  ['data_scientist', /\b(data scientist|cientifico de datos|cientifica de datos|research scientist)\b/],
  ['digital_analyst', /\b((marketing|growth|digital|web|ecommerce|e commerce|crm|campaign|performance)( \w+){0,2} analyst|analyst( \w+){0,2} (growth|marketing)|analista digital|web analytics)\b/],
  ['data_analyst', /\b(data analyst|analista de datos|bi analyst|business intelligence|bi developer|analytics analyst|product analyst|insights analyst|reporting analyst)\b/],

  ['qa_manager', /\b(qa manager|quality assurance manager|head of qa|test manager)\b/],
  ['qa_lead', /\b(qa lead|test lead|qa team lead|lead qa)\b/],
  ['qa_automation', /\b(qa automation|test automation|automation (qa|test\w*)|sdet|qa engineer|quality engineer|test engineer)\b/],
  ['qa_tester', /\b(qa|tester|quality assurance|testing)\b/],

  ['mobile_ios', /\b(ios|swift|flutter)\b/],
  ['mobile_android', /\b(android)\b/],
  ['mobile', /\b(mobile (developer|engineer|software engineer)|react native|desarrollador movil|desarrolladora movil|app developer)\b/],

  ['software_architect', /\b(software architect|arquitecto de software|arquitecta de software|technical architect|arquitecto tecnico)\b/],
  ['frontend', /\b(frontend|front end|react developer|angular developer|vue developer|maquetador|maquetadora)\b/],
  ['fullstack', /\b(full ?stack)\b/],
  ['java_developer', /\b(java|j2ee|spring boot)\b/],
  ['dotnet_developer', /\b(net developer|net engineer|dotnet|c sharp)\b/],
  ['python_developer', /\b(python|django)\b/],
  ['node_developer', /\b(node js|nodejs|node)\b/],
  ['golang_developer', /\b(golang|go developer|go engineer)\b/],
  ['php_developer', /\b(php|laravel|symfony)\b/],
  ['ruby_developer', /\b(ruby|rails)\b/],
  ['backend', /\b(backend|back end|software engineer|software developer|developer|desarrollador|desarrolladora|programador|programadora|ingeniero de software|ingeniera de software|web developer|web engineer)\b/],

  // Product and design.
  ['head_of_product', /\b(head of product|vp (of )?product|director of product|product director|chief product officer|cpo)\b/],
  ['product_owner', /\b(product owner)\b/],
  ['product_manager', /\b(product manager|product lead|responsable de producto|product management)\b/],
  ['head_of_design', /\b(head of design|design director|director of design|design manager|vp (of )?design)\b/],
  ['ux_researcher', /\b(ux research\w*|user research\w*)\b/],
  ['ux_writer', /\b(ux writer|content designer|ux content)\b/],
  ['ux_ui_designer', /\b(ux ui|ui ux)\b/],
  ['ui_designer', /\b(ui designer|disenador ui|disenadora ui)\b/],
  ['ux_designer', /\b(ux designer|interaction designer|disenador ux|disenadora ux|experience designer)\b/],
  ['product_designer', /\b(product designer|disenador de producto|disenadora de producto)\b/],
  ['graphic_designer', /\b(graphic designer|brand designer|disenador grafico|disenadora grafica|marketing artist|motion designer|creative designer|visual designer)\b/],
  ['copywriter', /\b(copywriter|redactor creativo|redactora creativa)\b/],

  // Marketing, communication and community.
  ['community_manager', /\b(community|comunidad|social media (specialist|executive|coordinator|assistant|analyst)|redes sociales)\b/],
  ['social_media_manager', /\b(social media|social (lead|manager|strategist|growth))\b/],
  ['marketing_director', /\b((head|director|directora|directeur|vp|vice president|chief)( of| de| du service)?( \w+){0,2} marketing|cmo|marketing director|director de marketing|directora de marketing)\b/],
  ['paid_media_director', /\b((head|director|vp) (of )?(paid|performance|media)|paid media director|performance marketing director|media director)\b/],
  ['martech_director', /\b((head|director) (of )?martech|martech director)\b/],
  ['seo_manager', /\b(seo (manager|lead|strategist|director|team lead|technical lead)|(head|director) of seo|seo \w+ manager|technical seo lead|on site seo team lead)\b/],
  ['seo_specialist', /\b(seo|aeo|geo specialist|search engine optimi[sz]ation|ai search|ai visibility)\b/],
  ['sem_manager', /\b((sem|ppc|paid search) (manager|lead))\b/],
  ['sem_specialist', /\b(sem|ppc|paid search|google ads)\b/],
  ['user_acquisition_manager', /\b(user acquisition|acquisition manager|app marketing)\b/],
  ['performance_manager', /\b((performance|paid (media|social|marketing)) (marketing )?(manager|lead|strategist)|paid marketing strategist)\b/],
  ['performance_specialist', /\b(performance|paid (media|social|marketing)|media buyer|trafficker)\b/],
  // A specialist in growth is not a growth manager: Hays has no row of its own for it.
  ['digital_marketing_specialist', /\b(growth( \w+)? (specialist|associate|executive|coordinator)|(specialist|associate|executive)( \w+)? growth)\b/],
  ['growth_manager', /\b(growth)\b/],
  ['marketing_automation', /\b(marketing automation|automation specialist|marketing operations|hubspot|marketo|braze)\b/],
  ['crm_manager', /\b(crm|lifecycle|retention marketing)\b/],
  ['email_marketing', /\b(email marketing|emailing|e mail marketing)\b/],
  ['martech_specialist', /\b(martech|marketing technology|marketing technologist)\b/],
  ['influencer_marketing', /\b(influencer|creator partnerships|creators? marketing)\b/],
  ['head_of_partnerships', /\b((head|director|vp) (of )?(strategic )?partnerships)\b/],
  ['comms_director', /\b((director|directora|head|vp) (of |de )?(corporate )?(communications?|comunicacion|comms|pr|public relations)|director de comunicacion|directora de comunicacion)\b/],
  ['pr_events_manager', /\b(pr|public relations|relaciones publicas|events? (manager|producer|lead|marketing)|event producer|live events)\b/],
  ['comms_manager', /\b(communications? (manager|lead)|comms (manager|lead)|responsable de comunicacion|internal communications|brand communications|corporate communications)\b/],
  ['comms_technician', /\b(tecnico de comunicacion|tecnica de comunicacion|communications? (specialist|executive|coordinator|officer)|comunicacion)\b/],
  ['content_manager', /\b(content (marketing )?(manager|lead|strategist|director|team lead)|head of (creative )?content|editorial (content )?manager|content strategy|senior editorial manager)\b/],
  ['content_specialist', /\b(content|contenido|contenidos|editor|editorial|writer|redactor|redactora)\b/],
  ['brand_manager', /\b(brand manager|brand marketing|brand lead|head of brand|brand strategist)\b/],
  ['trade_marketing', /\b(trade marketing)\b/],
  ['marketing_assistant', /\b(marketing (assistant|coordinator)|asistente de marketing)\b/],
  ['marketing_technician', /\b(tecnico de marketing|tecnica de marketing|tecnico\/a de marketing)\b/],
  ['digital_marketing_manager', /\b(digital marketing manager|ecommerce manager|e commerce manager|online marketing manager)\b/],
  ['marketing_manager', /\b(marketing manager|field marketing|marketing lead|responsable de marketing|regional marketing|partner marketing|b2b marketing|corporate marketing|marketing project manager|marketing strategy)\b/],
  ['digital_marketing_specialist', /\b(digital marketing|marketing digital|online marketing|marketing (specialist|executive|associate|consultant|analyst)|inbound)\b/],
]

// Not a role of the table whatever else the title says: training positions,
// and work whose title borrows a word of one ("Business Developer",
// "Implementation Specialist - Growth", "Video Editor (Paid Media)").
const NOT_A_ROLE = /\b(intern|internship|becario|becaria|practicas|trainee|apprentice|werkstudent|stagiaire|praktikant|talent pool|business develop\w*|implementation (specialist|manager|consultant|lead)|video editor|live ?ops|account (executive|manager)|sales (manager|representative|executive)|customer success|recruit\w*|fp a|finance)\b/

// A rule that matches but is not meant for these titles: an "SEO Technical
// Lead" leads SEO, not engineers.
const EXCEPT: Partial<Record<Role, RegExp>> = {
  tech_lead: /\b(seo|marketing|content|growth|brand|community|sales|design)\b/,
}

// Level words in titles. "Manager" is not a level: it is the noun of product,
// community and marketing roles.
const HEAD = /\b(head|director|directora|directeur|vp|vice president|chief|cmo|cto|cpo|ciso)\b/
const LEAD = /\b(lead|leader|principal|staff|jefe|jefa|lider)\b/
const SENIOR = /\b(senior|sr|snr|expert|experto|experta|iii|iv)\b/
const JUNIOR = /\b(junior|jr|entry level|graduate|assistant|asistente)\b/
// "Associate" is the first step, except in "associate director" and the like.
const ASSOCIATE = /\bassociate\b(?! (director|manager|principal|vp|head|partner))/

function levelOfTitle(title: string): Level | null {
  // "Associate Director": a director. "Senior Director": a director.
  if (HEAD.test(title)) return 'head'
  if (LEAD.test(title)) return 'lead'
  if (SENIOR.test(title)) return 'senior'
  if (/\bii\b/.test(title)) return 'mid'
  if (JUNIOR.test(title) || ASSOCIATE.test(title) || /\bi$/.test(title)) return 'junior'
  return null
}

// "5+ years of experience", "al menos 3 años de experiencia", "3-5 years in
// a similar role": the fewest years the text asks for, when it asks.
const YEARS = /\b(\d{1,2})\s*(?:\+|-\s*\d{1,2}|to \d{1,2}|a \d{1,2})?\s*\+?\s*(?:years?|yrs?|anos|años)\b(?:[^.\n]{0,60}?)\b(?:experience|experiencia|exp|in a similar|en un puesto|en posiciones|working)\b/gi

export function yearsAsked(description: string | null): number | null {
  if (!description) return null
  let fewest: number | null = null
  for (const match of description.matchAll(YEARS)) {
    const years = Number(match[1])
    if (years >= 1 && years <= 15 && (fewest === null || years < fewest)) fewest = years
  }
  return fewest
}

function levelOfYears(years: number): Level {
  if (years < 2) return 'junior'
  if (years < 5) return 'mid'
  return 'senior'
}

// Other Spanish cities and regions offers name: an estimate for "the rest of
// Spain". Normalised, like the location.
const SPAIN_ELSEWHERE = [
  'spain', 'espana', 'esp', 'malaga', 'sevilla', 'seville', 'bilbao', 'zaragoza', 'alicante', 'alacant', 'a coruna', 'la coruna',
  'coruna', 'vigo', 'donostia', 'san sebastian', 'palma', 'mallorca', 'murcia', 'granada', 'valladolid', 'gijon', 'oviedo',
  'pamplona', 'santander', 'cordoba', 'las palmas', 'tenerife', 'castellon', 'tarragona', 'girona', 'lleida', 'vitoria',
  'salamanca', 'leon', 'burgos', 'cadiz', 'almeria', 'huelva', 'jaen', 'badajoz', 'caceres', 'logrono', 'lugo', 'ourense',
  'pontevedra', 'santiago de compostela', 'elche', 'cartagena', 'marbella', 'ibiza', 'menorca', 'asturias', 'andalusia',
  'andalucia', 'catalonia', 'cataluna', 'galicia', 'basque country', 'pais vasco', 'euskadi', 'navarra', 'aragon', 'cantabria',
  'canarias', 'canary islands', 'baleares', 'balearic', 'extremadura', 'castilla', 'valencian community', 'comunidad valenciana',
]

const CITIES: Place[] = ['madrid', 'barcelona', 'valencia']

// The country itself, not a place in it.
const COUNTRY_WORDS = ['spain', 'espana', 'esp']

const names = (text: string, term: string) => ` ${text} `.includes(` ${term} `)

// The first place in Spain the offer lists: its city if it is Madrid,
// Barcelona or Valencia (their metropolitan towns included), otherwise the
// rest of Spain. A remote offer with no place, from a company built in Spain,
// is remote in Spain. Spain named only as one country among several, by a
// company from elsewhere, is not enough: such a company may pay as it does
// anywhere in Europe, and the Spanish guides say nothing about that. Anywhere
// else, they say nothing either.
export function placeOf(location: string | null, workplace: string | null, companySegment: string | null): Place | null {
  // Listed places, each read whole: "ES - Barcelona, Spain" is Barcelona.
  const listed = (location ?? '').split(/[·;|•]/).map((item) => normaliseTitle(item)).filter(Boolean)
  const builtInSpain = companySegment === 'spain'
  let countryOnly = false
  for (const item of listed) {
    for (const city of CITIES) if (cityAreaTerms(city).some((town) => names(item, town))) return city
    if (SPAIN_ELSEWHERE.some((term) => names(item, term) && !COUNTRY_WORDS.includes(term))) return 'spain'
    if (COUNTRY_WORDS.some((term) => names(item, term)) || /^es\b/.test(item)) countryOnly = true
  }
  if (countryOnly && (listed.length === 1 || builtInSpain)) return 'spain'
  // "Remote", or nothing at all for a remote role, from a company built in Spain.
  const saysNowhere = listed.every((item) => /^(remote|remoto|remota|fully remote|home based|anywhere)$/.test(item))
  if (saysNowhere && builtInSpain && (workplace === 'remote' || listed.length > 0)) return 'spain'
  return null
}

export function roleOf(title: string): Role | null {
  const normalised = normaliseTitle(title)
  if (NOT_A_ROLE.test(normalised)) return null
  // "Salesforce Marketing Cloud developer": the product is not the role.
  const withoutProducts = normalised.replace(/\b(salesforce marketing cloud|marketing cloud)\b/g, ' ')
  for (const [role, pattern] of ROLE_RULES) if (pattern.test(withoutProducts) && !EXCEPT[role]?.test(withoutProducts)) return role
  return null
}

// "Partnerships Representative UAE (Based in Dubai)": a title that names a
// place outside Spain is done from there, whatever the location field says.
function titleNamesElsewhere(title: string): boolean {
  const words = normaliseTitle(title).split(' ')
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const country = countryOf(words.slice(i, i + size).join(' '))
      if (country && country !== 'ES') return true
    }
  }
  return placeOutsideEurope(normaliseTitle(title))
}

export function keyOf(offer: {
  title: string
  location: string | null
  workplace: string | null
  description: string | null
  companySegment: string | null
}): OfferKey | NoKey {
  const role = roleOf(offer.title)
  if (!role) return 'role'
  const place = placeOf(offer.location, offer.workplace, offer.companySegment)
  if (!place || titleNamesElsewhere(offer.title)) return 'place'
  const titled = levelOfTitle(normaliseTitle(offer.title))
  if (titled) return { role, level: titled, place, levelFrom: 'title' }
  const years = yearsAsked(offer.description)
  if (years !== null) return { role, level: levelOfYears(years), place, levelFrom: 'experience' }
  return { role, level: 'mid', place, levelFrom: 'default' }
}

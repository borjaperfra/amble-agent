// One role, however many times a company posts it (#45).
//
// Tether posts «Product Engineering Lead, Keet (100% Remote, Worldwide)» once
// per group of cities, each with its own address, and Affirm the same role as
// «Software Engineer II, Backend (Furnishing Platform)» and «Software
// Engineer II , Backend, (Furnishing Platform)». Kept apart they are 19
// «offers» in someone's list. The key that makes them one: the company, the
// title without punctuation and without what only says where or how it is
// worked («(100% remote)», «(UK)», «- Remote Spain»), and the workplace.
// What names the team or product («(QVAC)», «(Card)») stays: that is another
// role.

const PLACE_WORDS =
  /\b(remote|remoto|remota|worldwide|anywhere|hybrid|hibrido|hibrida|onsite|on site|in office|presencial|teletrabajo|global|emea|apac|latam|europe|eu|uk|us|usa|spain|espana|portugal|germany|france|ireland|india|uae|canada|tz|time ?zone|cet|est|pst)\b/

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Bracketed parts and a trailing «- …» / «| …» that only say where, dropped;
// then only letters and digits, single-spaced.
export function roleTitle(title: string): string {
  let text = plain(title)
  text = text.replace(/[([]([^)\]]*)[)\]]/g, (whole, inside: string) => (PLACE_WORDS.test(inside) ? ' ' : ` ${inside} `))
  text = text.replace(/\s[-–—|·]\s([^-–—|·]*)$/, (whole, tail: string) => (PLACE_WORDS.test(tail) ? '' : whole))
  return text.replace(/[^a-z0-9]+/g, ' ').trim()
}

export function roleKey(offer: { company_id: string; title: string; workplace?: string | null }): string {
  return `${offer.company_id}|${roleTitle(offer.title)}|${offer.workplace ?? ''}`
}

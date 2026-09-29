// Finds the job board behind careers pages that are drawn in the browser, so
// the plain fetch in detectBoard sees no link to it. Each unresolved company
// of the directory is opened in a real Chrome; the board is looked for in the
// rendered page, its frames, its links and every request the page makes.
// A board counts only if it has open offers. Prints directory lines to pin.
//
//   npm run resolve-boards            every unresolved directory company
//   npm run resolve-boards -- Glovo   only those named
import { chromium } from 'playwright-core'
import { CHROME } from '../src/lib/apply/chrome'
import { BOARD_PATTERNS, boardOwner, NOT_TOKENS, readAtsBoard, sameCompany } from '../src/lib/sourcing/ats'
import { DIRECTORY } from '../src/lib/sourcing/directory'
import { listCompanies } from '../src/lib/db/opportunities'
import type { AtsKind } from '../src/lib/sourcing/types'

const PAGE_MS = 25_000
const AT_ONCE = 4

function boardsIn(text: string): { ats: AtsKind; token: string }[] {
  const found: { ats: AtsKind; token: string }[] = []
  for (const { ats, pattern } of BOARD_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, ats === 'workday' ? 'g' : 'gi'))) {
      const token = ats === 'workday' ? `${match[1].toLowerCase()}/${match[2]}` : match[1]
      if (NOT_TOKENS.has(token.split('.')[0].toLowerCase())) continue
      if (!found.some((item) => item.ats === ats && item.token === token)) found.push({ ats, token })
    }
  }
  return found
}

async function main() {
  const only = process.argv.slice(2).map((name) => name.toLowerCase())
  const unresolved = new Set(listCompanies().filter((company) => company.status !== 'watching').map((company) => company.name_norm))
  const entries = DIRECTORY.filter((entry) =>
    only.length > 0 ? only.includes(entry.name.toLowerCase()) : !entry.board && unresolved.has(entry.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()),
  )
  console.error(`${entries.length} companies to open`)
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const results: string[] = []
  const queue = [...entries]
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const url = entry.careersUrl ?? `https://${entry.domain}/careers`
        const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36' })
        const seen: string[] = []
        page.on('request', (request) => seen.push(request.url()))
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_MS }).catch(() => undefined)
          const html = await page.content().catch(() => '')
          const frames = page.frames().map((frame) => frame.url())
          const links = await page.$$eval('a[href]', (anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href)).catch(() => [] as string[])
          const candidates = boardsIn([html, ...frames, ...links, ...seen].join('\n'))
          let pinned: string | null = null
          for (const { ats, token } of candidates) {
            const jobs = await readAtsBoard(ats, token, entry.name).catch(() => null)
            // A board named on their page may be someone else's (a partner, an
            // integration): where the board names its owner, it must be them.
            const owner = jobs?.length ? await boardOwner(ats, token).catch(() => null) : null
            if (owner && !sameCompany(owner, entry.name, entry.domain)) continue
            if (jobs && jobs.length > 0) {
              // No owner named: the board's name must look like theirs, or a
              // person checks it before it is pinned.
              const named = owner !== null || sameCompany(token.split(/[./]/)[0].replace(/-/g, ' '), entry.name, entry.domain)
              pinned = `${named ? '' : 'CHECK '}${ats}:${token} (${jobs.length} open)`
              break
            }
          }
          const line = `${entry.name} | ${pinned ?? `none${candidates.length ? ` (seen: ${candidates.map((c) => `${c.ats}:${c.token}`).join(', ')})` : ''}`}`
          results.push(line)
          console.error(line)
        } finally {
          await page.close().catch(() => undefined)
        }
      }
    }),
  )
  await browser.close()
  console.log(results.sort().join('\n'))
}

void main()

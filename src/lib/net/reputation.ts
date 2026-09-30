import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY } from '../db/db'

// Whether a link is known to spread malware, from abuse.ch URLhaus's public
// lists: hosts that exist only to serve it, and the exact addresses of what is
// being served now (often on a shared host such as GitHub or Google Drive,
// which is why those count only as the exact address). Downloaded once a day,
// kept in memory and on disk, renewed in the background. If they cannot be
// had, links are let through as before: the check adds safety, never an outage.

const LISTS = {
  hosts: 'https://urlhaus.abuse.ch/downloads/hostfile/',
  urls: 'https://urlhaus.abuse.ch/downloads/text_online/',
} as const
type ListName = keyof typeof LISTS

const DAY_MS = 24 * 60 * 60 * 1000
const DOWNLOAD_MS = 15_000
const MAX_LIST_BYTES = 32 * 1024 * 1024
// The first check waits this long for the lists; later ones never wait.
const FIRST_WAIT_MS = 5_000

interface Lists {
  hosts: Set<string>
  urls: Set<string>
  loadedAt: number
}

interface Reputation {
  lists: Lists | null
  loading: Promise<Lists | null> | null
  warned: boolean
  // After a failed download, not tried again before this.
  retryAt: number
}

declare global {
  var __ambleReputation: Reputation | undefined
}

const state = (globalThis.__ambleReputation ??= { lists: null, loading: null, warned: false, retryAt: 0 })

const cacheFile = (name: ListName) => path.join(DATA_DIRECTORY, 'cache', `urlhaus-${name}.txt`)

// An address the way both lists are compared: no scheme (only https is ever
// fetched, but a listed http address is the same file), host in lower case,
// no trailing slash.
function normal(raw: string): string | null {
  try {
    const url = new URL(raw)
    const port = url.port ? `:${url.port}` : ''
    return `${url.hostname.toLowerCase()}${port}${url.pathname.replace(/\/+$/, '')}${url.search}`
  } catch {
    return null
  }
}

function parse(name: ListName, text: string): Set<string> {
  const entries = new Set<string>()
  for (const line of text.split('\n')) {
    const value = line.trim()
    if (!value || value.startsWith('#')) continue
    if (name === 'hosts') {
      const host = value.split(/\s+/)[1]
      if (host) entries.add(host.toLowerCase())
    } else {
      const address = normal(value)
      if (address) entries.add(address)
    }
  }
  return entries
}

async function download(name: ListName): Promise<string> {
  const response = await fetch(LISTS[name], { signal: AbortSignal.timeout(DOWNLOAD_MS), headers: { 'User-Agent': 'amble (link safety)' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > MAX_LIST_BYTES) throw new Error('list too large')
  // A list that does not look like one is not taken over the one kept.
  if (!/URLhaus|^https?:\/\//m.test(text)) throw new Error('not a URLhaus list')
  return text
}

function readCache(): { lists: Lists; fresh: boolean } | null {
  try {
    const stats = (['hosts', 'urls'] as const).map((name) => fs.statSync(cacheFile(name)))
    const loadedAt = Math.min(...stats.map((stat) => stat.mtimeMs))
    const lists = {
      hosts: parse('hosts', fs.readFileSync(cacheFile('hosts'), 'utf8')),
      urls: parse('urls', fs.readFileSync(cacheFile('urls'), 'utf8')),
      loadedAt,
    }
    return { lists, fresh: Date.now() - loadedAt < DAY_MS }
  } catch {
    return null
  }
}

async function refresh(): Promise<Lists | null> {
  try {
    const [hosts, urls] = await Promise.all([download('hosts'), download('urls')])
    fs.mkdirSync(path.dirname(cacheFile('hosts')), { recursive: true })
    fs.writeFileSync(cacheFile('hosts'), hosts)
    fs.writeFileSync(cacheFile('urls'), urls)
    state.lists = { hosts: parse('hosts', hosts), urls: parse('urls', urls), loadedAt: Date.now() }
    state.warned = false
    return state.lists
  } catch (error) {
    if (!state.warned) console.error('[reputation] URLhaus lists could not be downloaded; links are not checked against them:', error instanceof Error ? error.message : error)
    state.warned = true
    // Not asked again for an hour: a failing download is not retried on every link.
    state.retryAt = Date.now() + 60 * 60 * 1000
    return state.lists
  } finally {
    state.loading = null
  }
}

// The lists as they are now, starting a renewal when they are a day old.
function current(): Lists | null {
  let stale = false
  if (!state.lists) {
    const cached = readCache()
    if (cached) state.lists = cached.lists
    stale = !cached?.fresh
  } else {
    stale = Date.now() - state.lists.loadedAt >= DAY_MS
  }
  if (stale && Date.now() >= state.retryAt) state.loading ??= refresh()
  return state.lists
}

function listed(lists: Lists, raw: string): boolean {
  const address = normal(raw)
  if (!address) return false
  if (lists.urls.has(address)) return true
  // The host or any domain it is under, down to two labels.
  const labels = new URL(raw).hostname.toLowerCase().split('.')
  for (let start = 0; start <= labels.length - 2; start++) {
    if (lists.hosts.has(labels.slice(start).join('.'))) return true
  }
  return false
}

// For a link about to be fetched: waits a little for the lists the first time.
export async function isMaliciousLink(raw: string): Promise<boolean> {
  let lists = current()
  if (!lists && state.loading) {
    let timer: NodeJS.Timeout | undefined
    const wait = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FIRST_WAIT_MS)
    })
    lists = await Promise.race([state.loading, wait])
    clearTimeout(timer)
  }
  return lists ? listed(lists, raw) : false
}

// For a link about to be shown or sent: with the lists already at hand, never waiting.
export function isKnownMaliciousLink(raw: string): boolean {
  const lists = current()
  return lists ? listed(lists, raw) : false
}

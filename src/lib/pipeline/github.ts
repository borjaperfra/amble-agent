// GitHub reading.
//
// What a repository proves changed in 2026. Code in a repo shows that something
// shipped; it does not show who decided what, or who could explain it. See
// PRODUCT_SPEC §11.1. Everything read here therefore enters the graph as an
// assisted claim, awaiting a defence question — never as proof of individual skill.
//
// What we extract that attribution cannot erase: what the person chose to build,
// whether it shipped and is operated, how they decompose work, and their
// debugging signature.

import { serverText } from '../i18n/candidate'

const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'
const TIMEOUT_MS = 15_000

// Unauthenticated GitHub allows 60 requests/hour. Everything below stays well
// inside that; a token raises it to 5,000 and is read if present.
const MAX_ORGS = 3
const MAX_REPOS_PER_OWNER = 100
const MAX_DEEP_REPOS = 6
const MAX_README_CHARS = 4000
// Enough bytes for MAX_README_CHARS characters of any script.
const README_BYTES = MAX_README_CHARS * 4
const MAX_COMMITS = 40

export class GitHubError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GitHubError'
  }
}

interface GitHubRepo {
  name: string
  full_name: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  fork: boolean
  archived: boolean
  created_at: string
  pushed_at: string
  default_branch: string
  topics?: string[]
  homepage: string | null
}

interface GitHubCommit {
  commit: { message: string; author: { date: string } | null }
}

function headers(): Record<string, string> {
  const base: Record<string, string> = {
    'User-Agent': 'Amble/0.1 (source ingestion)',
    Accept: 'application/vnd.github+json',
  }
  const token = process.env.AMBLE_GITHUB_TOKEN?.trim()
  if (token) base.Authorization = `Bearer ${token}`
  return base
}

async function api<T>(path: string): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${API}${path}`, { headers: headers(), signal: controller.signal })
    if (response.status === 403 || response.status === 429) {
      throw new GitHubError(serverText().githubRateLimit, response.status)
    }
    if (!response.ok) return null
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof GitHubError) throw error
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// A file of a repository, only as much of it as is read (a README can be
// megabytes; its start is what goes in the digest).
async function raw(path: string, maxBytes: number): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${RAW}${path}`, { signal: controller.signal })
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
    return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8')
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

export function parseGitHubHandle(input: string): string | null {
  const handle = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
  return /^[A-Za-z0-9-]{1,39}$/.test(handle) ? handle : null
}

function describeRepo(repo: GitHubRepo, ownCommits?: number): string {
  const parts = [
    `- ${repo.full_name}`,
    repo.language ?? 'sin lenguaje principal',
    `${repo.stargazers_count}★`,
    `creado ${repo.created_at.slice(0, 10)}`,
    `último push ${repo.pushed_at.slice(0, 10)}`,
  ]
  if (repo.fork) parts.push('fork')
  if (repo.archived) parts.push('archivado')
  if (typeof ownCommits === 'number') parts.push(`${ownCommits} commits del candidato`)
  let text = parts.join(' · ')
  if (repo.description) text += `\n  Descripción: ${repo.description}`
  if (repo.topics?.length) text += `\n  Temas: ${repo.topics.join(', ')}`
  if (repo.homepage) text += `\n  Web: ${repo.homepage}`
  return text
}

export interface GitHubDigest {
  handle: string
  displayName: string | null
  content: string
  repoCount: number
  ownCommitCount: number
}

export async function buildGitHubDigest(handleOrUrl: string): Promise<GitHubDigest> {
  const handle = parseGitHubHandle(handleOrUrl)
  if (!handle) throw new GitHubError(serverText().githubInvalidHandle(handleOrUrl))

  const profile = await api<{
    login: string
    name: string | null
    bio: string | null
    company: string | null
    blog: string | null
    location: string | null
    public_repos: number
    followers: number
    created_at: string
  }>(`/users/${handle}`)
  if (!profile) throw new GitHubError(serverText().githubNoProfile(handle), 404)

  // What does not depend on anything else is asked at once: the same
  // requests as one by one, sooner.
  // Public events reveal the organisations someone actually works in, which org
  // membership often hides. Without this, an employed developer can look idle.
  const [ownRepos, orgs, events] = await Promise.all([
    api<GitHubRepo[]>(`/users/${handle}/repos?per_page=${MAX_REPOS_PER_OWNER}&sort=pushed`).then((repos) => repos ?? []),
    api<{ login: string }[]>(`/users/${handle}/orgs`).then((list) => list ?? []),
    api<{ type: string; repo: { name: string } }[]>(`/users/${handle}/events/public?per_page=100`).then((list) => list ?? []),
  ])

  const orgRepos: GitHubRepo[] = (
    await Promise.all(orgs.slice(0, MAX_ORGS).map((org) => api<GitHubRepo[]>(`/orgs/${org.login}/repos?per_page=${MAX_REPOS_PER_OWNER}&sort=pushed`)))
  ).flatMap((repos) => repos ?? [])

  const eventRepoNames = [...new Set(events.map((event) => event.repo.name))]
  const knownNames = new Set([...ownRepos, ...orgRepos].map((repo) => repo.full_name))
  for (const name of eventRepoNames) {
    if (knownNames.has(name)) continue
    const repo = await api<GitHubRepo>(`/repos/${name}`)
    if (repo) orgRepos.push(repo)
    if (orgRepos.length > MAX_REPOS_PER_OWNER) break
  }

  const candidateRepos = [...ownRepos, ...orgRepos]
  const activeNames = new Set(eventRepoNames)
  const deepTargets = candidateRepos
    .filter((repo) => !repo.fork)
    .sort((a, b) => {
      const aActive = activeNames.has(a.full_name) ? 1 : 0
      const bActive = activeNames.has(b.full_name) ? 1 : 0
      if (aActive !== bActive) return bActive - aActive
      return b.pushed_at.localeCompare(a.pushed_at)
    })
    .slice(0, MAX_DEEP_REPOS)

  const sections: string[] = []
  let ownCommitCount = 0

  sections.push(`[github] PERFIL PÚBLICO DE GITHUB: ${profile.login}`)
  sections.push(
    [
      profile.name ? `Nombre mostrado: ${profile.name}` : null,
      profile.bio ? `Bio: ${profile.bio}` : null,
      profile.company ? `Empresa: ${profile.company}` : null,
      profile.location ? `Ubicación: ${profile.location}` : null,
      profile.blog ? `Web: ${profile.blog}` : null,
      `Repositorios públicos: ${profile.public_repos} · Seguidores: ${profile.followers}`,
      `Cuenta creada: ${profile.created_at.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join('\n'),
  )

  sections.push(
    `[github] ATRIBUCIÓN — LEER ANTES DE EXTRAER\nTodo el contenido de esta fuente (código, README, mensajes de commit y las decisiones que contienen) puede estar co-producido con un agente de IA. NO es prueba de destreza técnica individual. Lo que sí sostiene: qué eligió construir esta persona, que llegó a producción, cómo reparte el trabajo y cómo depura. Cualquier afirmación sobre criterio técnico debe marcarse como pendiente de defensa.`,
  )

  if (ownRepos.length > 0) {
    sections.push(
      `[github] REPOSITORIOS PROPIOS (${ownRepos.length})\n${ownRepos.map((repo) => describeRepo(repo)).join('\n')}`,
    )
  }

  if (orgRepos.length > 0) {
    sections.push(
      `[github] REPOSITORIOS DE ORGANIZACIONES EN LAS QUE PARTICIPA (${orgRepos.length})\n${orgRepos
        .slice(0, 60)
        .map((repo) => describeRepo(repo))
        .join('\n')}`,
    )
  }

  // Each repository in detail, all of them at once, kept in their order.
  const details = await Promise.all(
    deepTargets.map(async (repo) => {
      const readmeAt = (name: string) => raw(`/${repo.full_name}/${repo.default_branch}/${name}`, README_BYTES)
      const [commits, readme] = await Promise.all([
        api<GitHubCommit[]>(`/repos/${repo.full_name}/commits?author=${handle}&per_page=${MAX_COMMITS}`).then((list) => list ?? []),
        readmeAt('README.md').then((text) => text ?? readmeAt('readme.md')),
      ])
      return { repo, commits, readme }
    }),
  )
  for (const { repo, commits, readme } of details) {
    ownCommitCount += commits.length

    const parts = [`[github] REPOSITORIO EN DETALLE: ${repo.full_name}`, describeRepo(repo, commits.length)]

    if (readme) {
      parts.push(`README (primeros ${MAX_README_CHARS} caracteres):\n${readme.slice(0, MAX_README_CHARS)}`)
    }

    if (commits.length > 0) {
      parts.push(
        `Mensajes de commit del candidato (${commits.length}):\n${commits
          .map((commit) => `  ${commit.commit.author?.date?.slice(0, 10) ?? '?'} — ${commit.commit.message.split('\n')[0].slice(0, 120)}`)
          .join('\n')}`,
      )
    }

    sections.push(parts.join('\n'))
  }

  if (eventRepoNames.length > 0) {
    const byType: Record<string, number> = {}
    for (const event of events) byType[event.type] = (byType[event.type] ?? 0) + 1
    sections.push(
      `[github] ACTIVIDAD PÚBLICA RECIENTE\nRepositorios tocados: ${eventRepoNames.join(', ')}\nEventos: ${Object.entries(
        byType,
      )
        .map(([type, count]) => `${type} ×${count}`)
        .join(', ')}`,
    )
  }

  // An explicit inventory lets claim extraction notice when another source cites
  // a repository that does not exist, instead of repeating the dead link as fact.
  sections.push(
    `[github] INVENTARIO COMPLETO DE REPOSITORIOS PÚBLICOS VERIFICADOS\nEstos son TODOS los repositorios públicos que existen bajo este usuario. Si otra fuente menciona un repositorio suyo que no está en esta lista, ese repositorio NO existe públicamente y la afirmación que lo cita está sin respaldo:\n${
      ownRepos.length > 0 ? ownRepos.map((repo) => `  - ${repo.full_name}`).join('\n') : '  (ninguno)'
    }`,
  )

  return {
    handle,
    displayName: profile.name,
    content: sections.join('\n\n'),
    repoCount: candidateRepos.length,
    ownCommitCount,
  }
}

/**
 * GitHub, read as evidence instead of stored as a link.
 *
 * Until now a GitHub profile was a URL in a row: "the profile is stored, not
 * read". That is the worst of both worlds — he answered the question and got
 * nothing back for it, and a CV kept claiming things his own code could have
 * shown.
 *
 * Everything here comes from the public REST API, no key required:
 *
 *   GET /users/{handle}                     who he says he is
 *   GET /users/{handle}/repos?type=owner    what he owns, newest push first
 *   GET /repos/{full}/languages             what he actually writes, in bytes
 *   GET /repos/{full}/readme                what the project says it is
 *   GET /repos/{full}/contents              what is at the root of it
 *
 * The last three cost one call each per repository, so only the first few
 * repositories get them. Which few is the whole judgement of this file: a
 * profile's top line is usually a fork or a dotfiles repo, and neither says
 * anything about how somebody builds. So forks and archived repositories drop
 * out, and what is left is ordered by stars and then by when it was last
 * pushed — attention first, then life.
 *
 * Two rules the rest of the pipeline depends on:
 *
 * 1. Every line of the document it produces is something the API returned.
 *    No inference, no rounding up, no "seems to be a backend engineer". The
 *    reading happens downstream, where it is recorded as a reading.
 * 2. What could not be read is counted and said, not silently missing. An
 *    unauthenticated caller gets sixty requests an hour and a popular profile
 *    can run into that; a document that quietly stops halfway would look like
 *    a candidate who stopped coding halfway.
 */

import { asArray, asRecord, asText } from './types'

const API = 'https://api.github.com'

/** Deep enough to be representative, shallow enough to fit the rate limit. */
export const REPOS_READ_IN_FULL = 6
/** A README past this is a book, and the head of it carries the description. */
const README_CHARS = 3_000
const ROOT_ENTRIES = 40

export interface GitHubResponse {
  status: number
  body: string
}

/** Injected so the tests never touch the network. */
export type GitHubGet = (path: string, accept: 'json' | 'raw') => Promise<GitHubResponse>

export interface GitHubRepo {
  name: string
  fullName: string
  url: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  topics: string[]
  license: string | null
  homepage: string | null
  createdAt: string | null
  pushedAt: string | null
  archived: boolean
  fork: boolean
}

export interface GitHubUser {
  handle: string
  name: string | null
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
  publicRepos: number
  followers: number
  createdAt: string | null
}

export interface GitHubRead {
  user: GitHubUser
  /** Everything he owns, as GitHub listed it. */
  repos: GitHubRepo[]
  text: string
  /** How many got a request of their own, README and all. */
  readInFull: number
  /** Repositories the rate limit or an error cost us. Zero is the good day. */
  unread: number
}

// ─── Reading what came back ───────────────────────────────────────────────

/**
 * A handle out of whatever he pasted.
 *
 * People paste `github.com/borjaperfra`, the full https URL, a link to one
 * repository, or just the handle. GitHub's own rule is the filter: letters,
 * digits and single hyphens, up to 39 characters. Anything else is not a
 * handle and guessing at it would send us reading a stranger's code.
 */
export function githubHandle(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withoutScheme = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')
    .replace(/^@/, '')
  const first = withoutScheme.split(/[/?#]/)[0]?.trim() ?? ''
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(first)) return null
  return first
}

export function userFrom(raw: unknown, fallbackHandle: string): GitHubUser {
  const record = asRecord(raw)
  return {
    handle: asText(record.login) ?? fallbackHandle,
    name: asText(record.name),
    bio: asText(record.bio),
    company: asText(record.company),
    location: asText(record.location),
    blog: asText(record.blog),
    publicRepos: typeof record.public_repos === 'number' ? record.public_repos : 0,
    followers: typeof record.followers === 'number' ? record.followers : 0,
    createdAt: asText(record.created_at),
  }
}

export function repoFrom(raw: unknown): GitHubRepo | null {
  const record = asRecord(raw)
  const name = asText(record.name)
  const fullName = asText(record.full_name)
  if (!name || !fullName) return null
  return {
    name,
    fullName,
    url: asText(record.html_url) ?? `https://github.com/${fullName}`,
    description: asText(record.description),
    language: asText(record.language),
    stars: typeof record.stargazers_count === 'number' ? record.stargazers_count : 0,
    forks: typeof record.forks_count === 'number' ? record.forks_count : 0,
    topics: asArray(record.topics)
      .map((topic) => asText(topic))
      .filter((topic): topic is string => topic !== null),
    license: asText(asRecord(record.license).spdx_id),
    homepage: asText(record.homepage),
    createdAt: asText(record.created_at),
    pushedAt: asText(record.pushed_at),
    archived: record.archived === true,
    fork: record.fork === true,
  }
}

/**
 * Which repositories are worth a request of their own.
 *
 * Forks are somebody else's architecture and archived repositories are a
 * decision he already made about them. What is left sorts by stars — the only
 * number on a profile that other people put there — and ties break on the
 * last push, because between two unnoticed repositories the live one is the
 * one that says what he does now.
 */
export function pickRepos(repos: GitHubRepo[], limit = REPOS_READ_IN_FULL): GitHubRepo[] {
  return repos
    .filter((repo) => !repo.fork && !repo.archived)
    .sort((a, b) => {
      if (b.stars !== a.stars) return b.stars - a.stars
      return (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '')
    })
    .slice(0, limit)
}

/**
 * The language split as GitHub counts it: bytes, not files.
 *
 * Kept to the four that carry the repository, and as percentages, because the
 * raw byte counts invite a precision nobody means — 4% of a repository is a
 * config file, not a language somebody knows.
 */
export function languageShare(raw: unknown, top = 4): string | null {
  const entries = Object.entries(asRecord(raw)).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0,
  )
  if (entries.length === 0) return null
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0)
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([language, bytes]) => `${language} ${Math.round((bytes / total) * 100)}%`)
    .join(', ')
}

/** The root of a repository, named exactly as it is named. */
export function rootEntries(raw: unknown): string[] {
  return asArray(raw)
    .map((entry) => {
      const record = asRecord(entry)
      const name = asText(record.name)
      if (!name) return null
      return record.type === 'dir' ? `${name}/` : name
    })
    .filter((name): name is string => name !== null)
    .slice(0, ROOT_ENTRIES)
}

// ─── The document ─────────────────────────────────────────────────────────

function repoHeading(repo: GitHubRepo): string {
  const facts = [
    repo.language,
    repo.stars > 0 ? `${repo.stars} stars` : null,
    repo.forks > 0 ? `${repo.forks} forks` : null,
    repo.license,
    repo.pushedAt ? `last push ${repo.pushedAt.slice(0, 10)}` : null,
    repo.createdAt ? `created ${repo.createdAt.slice(0, 10)}` : null,
  ].filter((fact): fact is string => Boolean(fact))
  return `${repo.name} — ${facts.join(' · ')}\n${repo.url}`
}

export interface RepoDetail {
  repo: GitHubRepo
  languages: string | null
  readme: string | null
  root: string[]
}

export function renderRead(
  user: GitHubUser,
  details: RepoDetail[],
  listed: GitHubRepo[],
  unread: number,
): string {
  const lines: string[] = []
  lines.push(`GitHub profile: https://github.com/${user.handle}`)
  const about = [
    user.name,
    user.company,
    user.location,
    user.blog,
    `${user.publicRepos} public repositories`,
    `${user.followers} followers`,
    user.createdAt ? `on GitHub since ${user.createdAt.slice(0, 10)}` : null,
  ].filter((fact): fact is string => Boolean(fact))
  lines.push(about.join(' · '))
  if (user.bio) lines.push(`Bio: ${user.bio}`)

  if (details.length > 0) {
    lines.push('', '--- Repositories read in full ---')
    for (const detail of details) {
      lines.push('', repoHeading(detail.repo))
      if (detail.repo.description) lines.push(`Description: ${detail.repo.description}`)
      if (detail.repo.topics.length > 0) lines.push(`Topics: ${detail.repo.topics.join(', ')}`)
      if (detail.repo.homepage) lines.push(`Homepage: ${detail.repo.homepage}`)
      if (detail.languages) lines.push(`Languages by bytes: ${detail.languages}`)
      if (detail.root.length > 0) lines.push(`Files at the root: ${detail.root.join(', ')}`)
      if (detail.readme) lines.push('README:', detail.readme)
    }
  }

  const read = new Set(details.map((detail) => detail.repo.fullName))
  const rest = listed.filter((repo) => !read.has(repo.fullName))
  if (rest.length > 0) {
    lines.push('', '--- Other repositories, listed only ---')
    for (const repo of rest) {
      const facts = [
        repo.language,
        repo.stars > 0 ? `${repo.stars} stars` : null,
        repo.fork ? 'fork' : null,
        repo.archived ? 'archived' : null,
        repo.pushedAt ? `last push ${repo.pushedAt.slice(0, 10)}` : null,
      ].filter((fact): fact is string => Boolean(fact))
      lines.push(
        `${repo.name} — ${facts.join(' · ')}${repo.description ? `. ${repo.description}` : ''}`,
      )
    }
  }

  // Said out loud rather than left as a short document. A reader who does not
  // know six repositories went unread would take this for the whole of him.
  if (unread > 0) {
    lines.push(
      '',
      `Note: ${unread} ${unread === 1 ? 'repository' : 'repositories'} could not be read in full (GitHub stopped answering, usually its hourly limit). This document is incomplete by that much.`,
    )
  }

  return lines.join('\n')
}

// ─── The reading itself ───────────────────────────────────────────────────

/**
 * The default caller. A token is optional and only buys rate limit: sixty
 * requests an hour without one, five thousand with. Nothing here needs a
 * scope, so a token with none is the right token.
 */
export function githubGet(token = process.env.GITHUB_TOKEN?.trim()): GitHubGet {
  return async (path, accept) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`${API}${path}`, {
        signal: controller.signal,
        headers: {
          Accept: accept === 'raw' ? 'application/vnd.github.raw' : 'application/vnd.github+json',
          'User-Agent': 'Amble/0.1 (source ingestion)',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      return { status: response.status, body: await response.text() }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function parse(response: GitHubResponse): unknown {
  try {
    return JSON.parse(response.body)
  } catch {
    return null
  }
}

/**
 * Read a profile, or say why not.
 *
 * Throws only when there is nothing at all — no such user, GitHub down. A
 * partial read is a success with a count attached, because a profile with
 * four repositories read and two missed is still worth far more than a URL in
 * a row.
 */
export async function readGitHub(handle: string, get: GitHubGet = githubGet()): Promise<GitHubRead> {
  const userResponse = await get(`/users/${handle}`, 'json')
  if (userResponse.status === 404) throw new Error(`no GitHub user called ${handle}`)
  if (userResponse.status !== 200) throw new Error(`GitHub answered ${userResponse.status}`)
  const user = userFrom(parse(userResponse), handle)

  const reposResponse = await get(
    `/users/${handle}/repos?per_page=100&sort=pushed&type=owner`,
    'json',
  )
  const listed =
    reposResponse.status === 200
      ? asArray(parse(reposResponse))
          .map((raw) => repoFrom(raw))
          .filter((repo): repo is GitHubRepo => repo !== null)
      : []

  const chosen = pickRepos(listed)
  const details: RepoDetail[] = []
  let unread = 0

  for (const repo of chosen) {
    try {
      const [languages, readme, root] = await Promise.all([
        get(`/repos/${repo.fullName}/languages`, 'json'),
        get(`/repos/${repo.fullName}/readme`, 'raw'),
        get(`/repos/${repo.fullName}/contents`, 'json'),
      ])
      // One 200 is enough to count the repository as read; a project with no
      // README is a normal project, not a failed request.
      if (languages.status !== 200 && readme.status !== 200 && root.status !== 200) {
        unread += 1
        continue
      }
      details.push({
        repo,
        languages: languages.status === 200 ? languageShare(parse(languages)) : null,
        readme:
          readme.status === 200 && readme.body.trim()
            ? readme.body.replace(/\r\n/g, '\n').trim().slice(0, README_CHARS)
            : null,
        root: root.status === 200 ? rootEntries(parse(root)) : [],
      })
    } catch {
      unread += 1
    }
  }

  return {
    user,
    repos: listed,
    text: renderRead(user, details, listed, unread),
    readInFull: details.length,
    unread,
  }
}

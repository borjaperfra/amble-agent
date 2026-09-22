/**
 * Reading GitHub, without GitHub.
 *
 * The fixtures are the shape the API actually answers with, trimmed to the
 * fields this reads. What is being defended here is mostly the judgement
 * calls, because the parsing is dull and the judgement is not:
 *
 *  - a handle out of whatever somebody pasted, and a firm no when it is not
 *    a handle, because the failure mode is reading a stranger's code and
 *    attributing it to him;
 *  - which repositories earn a request of their own, since forks and archives
 *    would otherwise eat the whole budget and say nothing about him;
 *  - and that a partial read says it is partial. A document that quietly
 *    stops halfway reads like somebody who stopped coding halfway.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  githubHandle,
  languageShare,
  pickRepos,
  readGitHub,
  renderRead,
  repoFrom,
  rootEntries,
  userFrom,
  type GitHubGet,
  type GitHubRepo,
} from './github'

const listedRepo = {
  name: 'amble',
  full_name: 'borjaperfra/amble',
  html_url: 'https://github.com/borjaperfra/amble',
  description: 'A representative that listens so you do not have to.',
  language: 'TypeScript',
  stargazers_count: 42,
  forks_count: 3,
  topics: ['agents', 'hiring'],
  license: { spdx_id: 'MIT' },
  homepage: 'https://amble.dev',
  created_at: '2025-11-02T08:00:00Z',
  pushed_at: '2026-09-18T19:22:11Z',
  archived: false,
  fork: false,
}

function repo(overrides: Partial<GitHubRepo>): GitHubRepo {
  return {
    name: 'r',
    fullName: 'u/r',
    url: 'https://github.com/u/r',
    description: null,
    language: null,
    stars: 0,
    forks: 0,
    topics: [],
    license: null,
    homepage: null,
    createdAt: null,
    pushedAt: null,
    archived: false,
    fork: false,
    ...overrides,
  }
}

describe('githubHandle', () => {
  it('takes the handle out of anything somebody would paste', () => {
    for (const input of [
      'borjaperfra',
      '@borjaperfra',
      'github.com/borjaperfra',
      'https://github.com/borjaperfra',
      'https://www.github.com/borjaperfra/',
      'https://github.com/borjaperfra/amble/blob/main/README.md',
      '  borjaperfra  ',
    ]) {
      assert.equal(githubHandle(input), 'borjaperfra', input)
    }
  })

  it('refuses anything that is not a handle instead of guessing', () => {
    // Every one of these would otherwise send us reading somebody else.
    for (const input of ['', '   ', 'https://gitlab.com/someone', '-leading', 'trailing-', 'a--b', 'x'.repeat(40)]) {
      assert.equal(githubHandle(input), null, JSON.stringify(input))
    }
  })

  it('keeps a hyphen that is really in the name', () => {
    assert.equal(githubHandle('https://github.com/anthropic-ai'), 'anthropic-ai')
  })
})

describe('repoFrom', () => {
  it('reads the fields that matter and nothing it was not given', () => {
    const parsed = repoFrom(listedRepo)
    assert.ok(parsed)
    assert.equal(parsed.name, 'amble')
    assert.equal(parsed.stars, 42)
    assert.equal(parsed.license, 'MIT')
    assert.deepEqual(parsed.topics, ['agents', 'hiring'])
    assert.equal(parsed.archived, false)
  })

  it('is null without a name, because a repository we cannot link to is not evidence', () => {
    assert.equal(repoFrom({ full_name: 'u/r' }), null)
    assert.equal(repoFrom(null), null)
  })

  it('does not invent counts when the field is missing', () => {
    const parsed = repoFrom({ name: 'r', full_name: 'u/r' })
    assert.ok(parsed)
    assert.equal(parsed.stars, 0)
    assert.equal(parsed.language, null)
    assert.equal(parsed.url, 'https://github.com/u/r')
  })
})

describe('pickRepos', () => {
  it('drops forks and archives before spending a request on them', () => {
    const picked = pickRepos(
      [
        repo({ name: 'fork', fullName: 'u/fork', stars: 900, fork: true }),
        repo({ name: 'old', fullName: 'u/old', stars: 500, archived: true }),
        repo({ name: 'mine', fullName: 'u/mine', stars: 1 }),
      ],
      6,
    )
    assert.deepEqual(picked.map((item) => item.name), ['mine'])
  })

  it('orders by stars, then by the last push', () => {
    const picked = pickRepos(
      [
        repo({ name: 'quiet', fullName: 'u/quiet', stars: 0, pushedAt: '2024-01-01T00:00:00Z' }),
        repo({ name: 'live', fullName: 'u/live', stars: 0, pushedAt: '2026-09-01T00:00:00Z' }),
        repo({ name: 'noticed', fullName: 'u/noticed', stars: 7, pushedAt: '2020-01-01T00:00:00Z' }),
      ],
      6,
    )
    assert.deepEqual(picked.map((item) => item.name), ['noticed', 'live', 'quiet'])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      repo({ name: `r${index}`, fullName: `u/r${index}`, stars: 20 - index }),
    )
    assert.equal(pickRepos(many, 6).length, 6)
  })
})

describe('languageShare', () => {
  it('turns bytes into the shares somebody would say out loud', () => {
    assert.equal(
      languageShare({ TypeScript: 800_000, CSS: 150_000, JavaScript: 50_000 }),
      'TypeScript 80%, CSS 15%, JavaScript 5%',
    )
  })

  it('keeps only the languages that carry the repository', () => {
    const share = languageShare(
      { TypeScript: 100, CSS: 90, Python: 80, Go: 70, Shell: 60, Makefile: 1 },
      4,
    )
    assert.equal(share, 'TypeScript 25%, CSS 22%, Python 20%, Go 17%')
  })

  it('is null when GitHub counted nothing', () => {
    assert.equal(languageShare({}), null)
    assert.equal(languageShare({ TypeScript: 0 }), null)
    assert.equal(languageShare(null), null)
  })
})

describe('rootEntries', () => {
  it('names directories as directories, because that is the shape of a project', () => {
    assert.deepEqual(
      rootEntries([
        { name: 'src', type: 'dir' },
        { name: 'Dockerfile', type: 'file' },
        { name: 'package.json', type: 'file' },
      ]),
      ['src/', 'Dockerfile', 'package.json'],
    )
  })

  it('survives a repository with no root listing', () => {
    assert.deepEqual(rootEntries(null), [])
  })
})

describe('renderRead', () => {
  const user = userFrom(
    {
      login: 'borjaperfra',
      name: 'Borja',
      bio: 'Building Amble.',
      company: 'Helmcode',
      location: 'Madrid',
      blog: 'https://helmcode.com',
      public_repos: 12,
      followers: 30,
      created_at: '2016-04-01T00:00:00Z',
    },
    'borjaperfra',
  )
  const parsed = repoFrom(listedRepo) as GitHubRepo

  it('puts a link next to everything it says', () => {
    const text = renderRead(user, [{ repo: parsed, languages: 'TypeScript 91%', readme: '# Amble', root: ['src/'] }], [parsed], 0)
    assert.match(text, /GitHub profile: https:\/\/github\.com\/borjaperfra/)
    assert.match(text, /https:\/\/github\.com\/borjaperfra\/amble/)
    assert.match(text, /Languages by bytes: TypeScript 91%/)
    assert.match(text, /Files at the root: src\//)
    assert.match(text, /# Amble/)
  })

  it('says when it could not read everything, instead of just being shorter', () => {
    const text = renderRead(user, [], [parsed], 3)
    assert.match(text, /3 repositories could not be read in full/)
    assert.match(text, /incomplete by that much/)
  })

  it('says nothing about unread repositories on the good day', () => {
    const text = renderRead(user, [{ repo: parsed, languages: null, readme: null, root: [] }], [parsed], 0)
    assert.doesNotMatch(text, /could not be read/)
  })

  it('lists the ones it did not open in full, so they are not lost', () => {
    const other = repo({ name: 'dotfiles', fullName: 'u/dotfiles', language: 'Shell' })
    const text = renderRead(user, [{ repo: parsed, languages: null, readme: null, root: [] }], [parsed, other], 0)
    assert.match(text, /Other repositories, listed only/)
    assert.match(text, /dotfiles — Shell/)
  })
})

describe('readGitHub', () => {
  function fakeGet(routes: Record<string, { status: number; body: string }>): GitHubGet {
    return async (path) => routes[path] ?? { status: 404, body: '{}' }
  }

  const profile = JSON.stringify({ login: 'borjaperfra', name: 'Borja', public_repos: 2, followers: 30 })

  it('reads a profile end to end', async () => {
    const read = await readGitHub(
      'borjaperfra',
      fakeGet({
        '/users/borjaperfra': { status: 200, body: profile },
        '/users/borjaperfra/repos?per_page=100&sort=pushed&type=owner': {
          status: 200,
          body: JSON.stringify([listedRepo]),
        },
        '/repos/borjaperfra/amble/languages': { status: 200, body: '{"TypeScript":900,"CSS":100}' },
        '/repos/borjaperfra/amble/readme': { status: 200, body: '# Amble\n\nIt listens.' },
        '/repos/borjaperfra/amble/contents': {
          status: 200,
          body: JSON.stringify([{ name: 'src', type: 'dir' }, { name: 'Dockerfile', type: 'file' }]),
        },
      }),
    )
    assert.equal(read.user.handle, 'borjaperfra')
    assert.equal(read.readInFull, 1)
    assert.equal(read.unread, 0)
    assert.match(read.text, /TypeScript 90%, CSS 10%/)
    assert.match(read.text, /It listens\./)
    assert.match(read.text, /Dockerfile/)
  })

  it('counts a repository the rate limit took, and still returns the rest', async () => {
    const read = await readGitHub(
      'borjaperfra',
      fakeGet({
        '/users/borjaperfra': { status: 200, body: profile },
        '/users/borjaperfra/repos?per_page=100&sort=pushed&type=owner': {
          status: 200,
          body: JSON.stringify([listedRepo]),
        },
        // All three come back 403: this is what the hourly limit looks like.
        '/repos/borjaperfra/amble/languages': { status: 403, body: '{}' },
        '/repos/borjaperfra/amble/readme': { status: 403, body: '{}' },
        '/repos/borjaperfra/amble/contents': { status: 403, body: '{}' },
      }),
    )
    assert.equal(read.readInFull, 0)
    assert.equal(read.unread, 1)
    assert.match(read.text, /1 repository could not be read in full/)
    // The profile itself still made it, so this is worth keeping.
    assert.match(read.text, /GitHub profile: https:\/\/github\.com\/borjaperfra/)
  })

  it('keeps a repository that simply has no README', async () => {
    const read = await readGitHub(
      'borjaperfra',
      fakeGet({
        '/users/borjaperfra': { status: 200, body: profile },
        '/users/borjaperfra/repos?per_page=100&sort=pushed&type=owner': {
          status: 200,
          body: JSON.stringify([listedRepo]),
        },
        '/repos/borjaperfra/amble/languages': { status: 200, body: '{"Go":10}' },
        '/repos/borjaperfra/amble/readme': { status: 404, body: '{}' },
        '/repos/borjaperfra/amble/contents': { status: 200, body: '[]' },
      }),
    )
    assert.equal(read.unread, 0)
    assert.equal(read.readInFull, 1)
  })

  it('refuses a handle that does not exist rather than storing an empty document', async () => {
    await assert.rejects(
      () => readGitHub('nobody', fakeGet({ '/users/nobody': { status: 404, body: '{}' } })),
      /no GitHub user called nobody/,
    )
  })
})

/**
 * What `node --test` needs to read this project's source, and nothing more.
 *
 * Node 22 strips the types out of a `.ts` file on its own, so no build step
 * and no test framework is needed here. What it will not do is guess at the
 * two conveniences the app is written with: the `@/` alias from tsconfig,
 * and imports left without an extension. This hook resolves both, so the
 * test suite adds zero dependencies to a project that has five.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const src = path.join(process.cwd(), 'src')
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']

export async function resolve(specifier, context, nextResolve) {
  let target = specifier

  if (target.startsWith('@/')) {
    target = pathToFileURL(path.join(src, target.slice(2))).href
  } else if (target.startsWith('.') && context.parentURL?.startsWith('file:')) {
    target = new URL(target, context.parentURL).href
  }

  if (target.startsWith('file:') && !path.extname(fileURLToPath(target))) {
    const base = fileURLToPath(target)
    for (const extension of EXTENSIONS) {
      if (existsSync(base + extension)) {
        target = pathToFileURL(base + extension).href
        break
      }
    }
  }

  return nextResolve(target, context)
}

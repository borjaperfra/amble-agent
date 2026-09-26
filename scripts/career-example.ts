// Renders the career.md examples from the fictional fixture, through the same
// renderer the product uses. No database, no model.
//
//   npm run career:example          regenerate the examples
//   npm run career:example:check    fail if the renderer's output has drifted
//
// The check is the regression test for render.ts: a change to the format must
// show up as a diff to these files and be committed on purpose.
//
// career.example.md is the example proper (the fixture candidate writes in
// Spanish). career.example.en.md renders the same data with the English frame:
// its statements stay in Spanish, because they are the candidate's; it exists
// to test the English headings, tags and notes.

import fs from 'node:fs'
import path from 'node:path'
import { renderCareerMarkdown } from '../src/lib/career/render'
import { exampleCareer } from '../src/fixtures/career'
import type { Locale } from '../src/lib/i18n/locale'

const targets: { locale: Locale; file: string }[] = [
  { locale: 'es', file: 'career.example.md' },
  { locale: 'en', file: 'career.example.en.md' },
]

const check = process.argv.includes('--check')
let drifted = false

for (const { locale, file } of targets) {
  const target = path.join(process.cwd(), 'src', 'fixtures', file)
  const { markdown, stats } = renderCareerMarkdown({ ...exampleCareer, locale })
  const output = `${markdown}\n`

  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null
    if (current !== output) {
      console.error(`${file} is out of date with the renderer. Run: npm run career:example`)
      drifted = true
    } else {
      console.log(`${file} matches the renderer.`)
    }
  } else {
    fs.writeFileSync(target, output, 'utf8')
    console.log(`Wrote ${path.relative(process.cwd(), target)}`, stats)
  }
}

if (drifted) process.exit(1)

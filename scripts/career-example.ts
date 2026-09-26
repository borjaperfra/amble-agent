// Renders src/fixtures/career.example.md from the fictional fixture, through the
// same renderer the product uses. No database, no model.
//
//   npm run career:example          regenerate the example
//   npm run career:example:check    fail if the renderer's output has drifted
//
// The check is the regression test for render.ts: a change to the format must
// show up as a diff to this file and be committed on purpose.

import fs from 'node:fs'
import path from 'node:path'
import { renderCareerMarkdown } from '../src/lib/career/render'
import { exampleCareer } from '../src/fixtures/career'

const target = path.join(process.cwd(), 'src', 'fixtures', 'career.example.md')
const { markdown, stats } = renderCareerMarkdown(exampleCareer)
const output = `${markdown}\n`

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null
  if (current !== output) {
    console.error('career.example.md is out of date with the renderer. Run: npm run career:example')
    process.exit(1)
  }
  console.log('career.example.md matches the renderer.')
} else {
  fs.writeFileSync(target, output, 'utf8')
  console.log(`Wrote ${path.relative(process.cwd(), target)}`, stats)
}

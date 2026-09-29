// Checks a job board before it is pinned in the directory: how many offers it
// has open and, where the board says, whose it is.
//   npm run verify-board -- <ats> <token> "<Company name>"
import { boardOwner, readAtsBoard, sameCompany } from '../src/lib/sourcing/ats'
import type { AtsKind } from '../src/lib/sourcing/types'

async function main() {
  const [ats, token, name] = process.argv.slice(2)
  if (!ats || !token || !name) {
    console.log('usage: npm run verify-board -- <ats> <token> "<Company name>"')
    return
  }
  const jobs = await readAtsBoard(ats as AtsKind, token, name).catch((error) => `error: ${String(error)}`)
  const owner = await boardOwner(ats as AtsKind, token).catch(() => null)
  const open = Array.isArray(jobs) ? jobs.length : jobs
  console.log(JSON.stringify({ ats, token, name, open, owner, ownerMatches: owner ? sameCompany(owner, name) : null, sample: Array.isArray(jobs) ? jobs.slice(0, 3).map((job) => job.title) : [] }))
}
void main()

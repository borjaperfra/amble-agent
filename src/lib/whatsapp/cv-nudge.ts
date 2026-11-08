import { getDb } from '../db/db'
import { candidateById, isSearchPaused, now } from '../db/repo'
import { buildCvReview, cvReviewState, latestReview } from '../career/cv-review'
import { waitingToRelease } from '../matching/release'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { reachableCandidateIds, reachOf } from '../channel/reach'
import { logMessage } from './conversation'
import { appUrl } from './offers'
import { wroteFirstRecently } from './proactive'

// Their CV compared with their offers (#55), told once in the chat to whoever
// has not opened it: «quizás, si la persona no ha analizado su CV, se le
// puede decir por WhatsApp/Telegram en algún momento» (Borja, 08-11). The
// last thing amble writes first: after the afternoon's offers, only to someone
// it wrote nothing to today and who has no offer waiting, and only when there
// is something they have done that their CV does not say, named in the message.

// Reviews built in one round at most: each is a long model call.
const BUILDS_PER_ROUND = 5

interface Due {
  id: string
}

function notTold(): Due[] {
  return getDb()
    .prepare('SELECT id FROM candidates WHERE cv_review_told_at IS NULL AND cv_review_opened_at IS NULL')
    .all() as unknown as Due[]
}

export async function sendDueCvNudges(): Promise<{ told: number; built: number }> {
  const reachable = new Set(reachableCandidateIds())
  let told = 0
  let built = 0
  for (const { id: candidateId } of notTold()) {
    if (!reachable.has(candidateId)) continue
    const reach = reachOf(candidateId)
    if (!reach || !reach.open || isSearchPaused(candidateId) || wroteFirstRecently(candidateId)) continue
    if (waitingToRelease(candidateId).length > 0) continue
    const { state, build } = cvReviewState(candidateId)
    let review = state.kind === 'ready' && !state.stale ? state.review : null
    if (!review && build && built < BUILDS_PER_ROUND) {
      built++
      review = await buildCvReview(candidateId).catch(() => null)
    }
    review ??= state.kind === 'ready' ? latestReview(candidateId) : null
    const first = review?.hidden[0]
    if (!review || !first) continue
    const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
    const text = w.cvNudge(review.hidden.length, first.need, appUrl(candidateId, '/me/cv'))
    await reach.send({ text, idempotencyKey: `cv:${candidateId}` })
    getDb().prepare('UPDATE candidates SET cv_review_told_at = ? WHERE id = ?').run(now(), candidateId)
    logMessage(candidateId, 'out', text)
    told++
  }
  return { told, built }
}

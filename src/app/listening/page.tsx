import { isUserZero } from '@/lib/features'
import { getListeningViewModel } from '@/lib/view'
import { getPendingInterruption } from '@/lib/opportunity-view'
import { openQuestionFor } from '@/lib/pipeline/opportunity-questions'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { listExceptions } from '@/lib/pipeline/exceptions'
import { listOpenAdvice } from '@/lib/db/advice'
import { readPreferences } from '@/lib/pipeline/preferences'
import { getOpportunity } from '@/lib/db/opportunities'
import FixtureListeningFlow from '@/components/fixture/FixtureListeningFlow'
import UserZeroListeningFlow from '@/components/userzero/UserZeroListeningFlow'

export const dynamic = 'force-dynamic'

export default function ListeningPage() {
  if (!isUserZero()) return <FixtureListeningFlow />
  // Quién ha entrado. Es la única capa que debería preguntarlo: todo lo que
  // hay debajo lo recibe.
  const candidateId = getOrCreateCandidate().id
  const vm = getListeningViewModel(candidateId)
  // Rendered here as well as polled, so someone who opens the app to a
  // notification lands on the thing itself rather than on six seconds of
  // "nothing worth bothering you with".
  const open = openQuestionFor(candidateId)
  const about = open ? getOpportunity(open.opportunity_id) : null

  return (
    <UserZeroListeningFlow
      vm={vm}
      interruption={getPendingInterruption(candidateId)}
      exceptions={listExceptions(candidateId, readPreferences(candidateId).language === 'en' ? 'en' : 'es')}
      // Copiadas a objetos normales: `node:sqlite` devuelve las filas sin
      // prototipo y React se niega a pasarlas al cliente.
      threads={listOpenAdvice(candidateId, 8).map((row) => ({
        id: row.id,
        side: row.side,
        text: row.text,
      }))}
      question={
        open
          ? {
              id: open.id,
              question: open.question,
              reason: open.reason,
              company: about?.company ?? null,
              role: about?.role ?? null,
            }
          : null
      }
    />
  )
}

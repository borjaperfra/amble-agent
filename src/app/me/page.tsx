import { after } from 'next/server'
import { requireCandidate } from '@/lib/auth/session'
import { nextStep } from '@/lib/journey'
import { getMapViewModel } from '@/lib/view'
import { rewriteExplanationsInBackground } from '@/lib/career/explanations'
import { serverLocale } from '@/lib/i18n/server'
import { isSearchPaused } from '@/lib/pause'
import { chatAvailability } from '@/lib/channel/reach'
import MapView, { type MapNextStep } from '@/components/flows/MapView'

export const dynamic = 'force-dynamic'

// What is missing, first: the step of the setup they have not taken, or
// connecting WhatsApp once everything else is done.
function mapNextStep(candidateId: string, step: string): MapNextStep {
  if (step === '/me/intent') return { kind: 'intent' }
  if (step === '/onboarding/interview') return { kind: 'questions' }
  if (step === '/onboarding' || step === '/welcome') return { kind: 'sources' }
  const chat = chatAvailability(candidateId)
  if (chat.available && !chat.linked) return { kind: 'whatsapp' }
  return { kind: 'done' }
}

export default async function MapPage() {
  const candidate = await requireCandidate()
  // Anything on the profile still written the old way is rewritten for them,
  // without making them wait: the next visit shows it.
  after(() => rewriteExplanationsInBackground(candidate.id))
  // What is still unknown is asked on WhatsApp: only once it is linked.
  const whatsapp = chatAvailability(candidate.id)
  return (
    <MapView
      vm={getMapViewModel(candidate.id, await serverLocale())}
      next={mapNextStep(candidate.id, nextStep(candidate))}
      owner={candidate.role === 'owner'}
      paused={isSearchPaused(candidate.id)}
      whatsapp={whatsapp}
    />
  )
}

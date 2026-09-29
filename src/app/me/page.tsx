import { requireCandidate } from '@/lib/auth/session'
import { nextStep } from '@/lib/journey'
import { getMapViewModel } from '@/lib/view'
import { serverLocale } from '@/lib/i18n/server'
import { linkOf } from '@/lib/whatsapp/link'
import { zernioConfig } from '@/lib/whatsapp/zernio'
import MapView, { type MapNextStep } from '@/components/flows/MapView'

export const dynamic = 'force-dynamic'

// What is missing, first: the step of the setup they have not taken, or
// connecting WhatsApp once everything else is done.
function mapNextStep(candidateId: string, step: string): MapNextStep {
  if (step === '/me/intent') return { kind: 'intent' }
  if (step === '/onboarding/interview') return { kind: 'questions' }
  if (step === '/onboarding' || step === '/welcome') return { kind: 'sources' }
  if (zernioConfig() && !linkOf(candidateId)) return { kind: 'whatsapp' }
  return { kind: 'done' }
}

export default async function MapPage() {
  const candidate = await requireCandidate()
  return <MapView vm={getMapViewModel(candidate.id, await serverLocale())} next={mapNextStep(candidate.id, nextStep(candidate))} owner={candidate.role === 'owner'} />
}

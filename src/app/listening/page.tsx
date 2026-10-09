import { requireCandidate } from '@/lib/auth/session'
import { getRevealedPreference, listOfferProbes } from '@/lib/db/repo'
import { isRereading, startFirstRead } from '@/lib/matching/run'
import { isSearchPaused } from '@/lib/pause'
import { getListeningViewModel } from '@/lib/view'
import { chatAvailability } from '@/lib/channel/reach'
import ListeningFlow from '@/components/flows/ListeningFlow'

export const dynamic = 'force-dynamic'

// Why a rule is believed names the sample offers it came from by number:
// their titles, by rule, so the page can name them instead.
function offerTitles(ids: string[]): Record<string, Record<number, string>> {
  const byTriage = new Map<string, Record<number, string>>()
  const titles: Record<string, Record<number, string>> = {}
  for (const id of ids) {
    const preference = getRevealedPreference(id)
    // A rule said in conversation came from no sample offers.
    if (!preference?.triage_id) continue
    let probes = byTriage.get(preference.triage_id)
    if (!probes) {
      probes = Object.fromEntries(listOfferProbes(preference.triage_id).map((probe) => [probe.idx + 1, probe.title]))
      byTriage.set(preference.triage_id, probes)
    }
    titles[id] = probes
  }
  return titles
}

export default async function ListeningPage() {
  const candidate = await requireCandidate()
  // The first time they are here with something to listen for, the Rep starts
  // reading for them at once.
  const firstReading = startFirstRead(candidate.id)
  // Setting up ends by connecting WhatsApp: from then on the Rep writes there.
  const whatsapp = chatAvailability(candidate.id)
  // Paused until they resume it; or reading again after a change to their rules.
  const paused = isSearchPaused(candidate.id)
  const rereading = !paused && isRereading(candidate.id)
  const vm = getListeningViewModel(candidate.id)
  const { wontConsider, weighs, money } = vm.revealed.rules
  const titles = offerTitles([...wontConsider, ...weighs, ...money].filter((item) => item.evidence).map((item) => item.id))
  return <ListeningFlow vm={{ ...vm, firstReading, rereading, paused, whatsapp, offerTitles: titles }} />
}

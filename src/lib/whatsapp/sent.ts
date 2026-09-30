import { getDb } from '../db/db'
import { candidateById } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { logMessage } from './conversation'
import { linkOf, windowOpen } from './link'
import { sendMessage, zernioConfig } from './zernio'

// An application they sent from the live view, after asking for it on
// WhatsApp: told there, where they asked.
export async function tellSent(candidateId: string, opportunityId: string): Promise<void> {
  const config = zernioConfig()
  const link = linkOf(candidateId)
  if (!config || !link?.conversation_id) return
  const offer = getDb().prepare('SELECT c.name AS company FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.id = ?').get(opportunityId) as
    | { company: string }
    | undefined
  const text = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp.fillSent(offer?.company ?? '')
  await sendMessage(config, { conversationId: link.conversation_id, text, utility: !windowOpen(link), idempotencyKey: `sent:${candidateId}:${opportunityId}` })
  logMessage(candidateId, 'out', text)
}

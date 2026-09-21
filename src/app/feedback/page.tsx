import { getOrCreateCandidate } from '@/lib/db/repo'
import { listFeedbackNotes } from '@/lib/db/feedback'
import FeedbackNotebook from '@/components/FeedbackNotebook'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ideas · Amble',
}

/**
 * La libreta, servida ya escrita.
 *
 * Renderizada en el servidor y no pedida después, por lo mismo que la
 * interrupción: esto se abre desde el móvil, a veces con media barra de
 * cobertura, y una lista que aparece dos segundos más tarde es una lista que
 * parece vacía.
 */
export default function FeedbackPage() {
  const candidate = getOrCreateCandidate()
  // Copiadas a objetos normales antes de cruzar al cliente: `node:sqlite`
  // devuelve las filas sin prototipo y React se niega a serializarlas —«Only
  // plain objects... can be passed to Client Components», y la pantalla
  // entera es un 500.
  const notes = listFeedbackNotes(candidate.id).map((note) => ({ ...note }))
  return <FeedbackNotebook initialNotes={notes} />
}

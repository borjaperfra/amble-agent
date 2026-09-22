import { getOrCreateCandidate } from '@/lib/db/repo'
import { adminView } from '@/lib/admin'
import AdminPanel from '@/components/AdminPanel'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Panel · Amble',
}

/**
 * El sitio donde se mira cuando algo no cuadra.
 *
 * Detrás de la contraseña como todo lo demás — aquí están los correos de la
 * lista de espera, que son de otra gente.
 *
 * Servido ya escrito y no pedido después: lo que se busca aquí casi siempre
 * es una comparación entre dos cosas de tablas distintas, y eso no se ve si
 * cada bloque va llegando por su cuenta.
 */
export default function AdminPage() {
  const candidateId = getOrCreateCandidate().id
  const view = adminView(candidateId)

  // Copiadas a objetos normales antes de cruzar al cliente: `node:sqlite`
  // devuelve las filas sin prototipo y React se niega a pasarlas.
  return <AdminPanel view={JSON.parse(JSON.stringify(view))} />
}

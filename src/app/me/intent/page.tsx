import { isUserZero } from '@/lib/features'
import { getLatestIntent, getOrCreateCandidate, parseJsonArray } from '@/lib/db/repo'
import { readPreferences } from '@/lib/pipeline/preferences'
import FixtureIntentFlow from '@/components/fixture/FixtureIntentFlow'
import UserZeroIntentFlow from '@/components/userzero/UserZeroIntentFlow'

export const dynamic = 'force-dynamic'

/**
 * Lo que ya dijo, cargado antes de preguntarle nada.
 *
 * Hasta hoy esta pantalla arrancaba siempre en «cuéntame qué tendría que
 * pasar para que te plantearas irte», con la caja vacía, como si nunca
 * hubiera contestado. Y él lo dijo tal cual el 22: *«¿Listening for se
 * rellena una vez? ¿O se queda siempre ahí con el área de texto y el tap to
 * talk?»*.
 *
 * Lo tenía guardado desde el primer día — el intent y las preferencias están
 * en la base — pero nadie las leía al entrar. Preguntarle otra vez lo que ya
 * contestó es exactamente la regla que él mismo puso el 19 sobre no
 * repreguntar, incumplida en su propia pantalla de ajustes.
 */
export default function IntentPage() {
  if (!isUserZero()) return <FixtureIntentFlow />

  const candidateId = getOrCreateCandidate().id
  const intent = getLatestIntent(candidateId)
  const preferences = readPreferences(candidateId)

  const groups = intent
    ? (JSON.parse(intent.groups) as { label: string; values: string[] }[]).filter(
        (group) => Array.isArray(group?.values),
      )
    : []

  return (
    <UserZeroIntentFlow
      initial={
        intent
          ? {
              id: intent.id,
              // Copiado a objetos normales: `node:sqlite` devuelve las filas
              // sin prototipo y React no las deja cruzar al cliente.
              groups: groups.map((group) => ({ label: group.label, values: [...group.values] })),
              listeningFor: parseJsonArray(intent.listening_for),
              rawAnswer: intent.raw_answer,
              saidAt: intent.created_at,
              confirmed: Boolean(intent.confirmed_at),
              preferences: {
                salaryMin: preferences.salaryMin,
                salaryCurrency: preferences.salaryCurrency,
                workMode: preferences.workMode,
                location: preferences.location,
                technologies: [...preferences.technologies],
                stages: [...preferences.stages],
              },
            }
          : null
      }
    />
  )
}

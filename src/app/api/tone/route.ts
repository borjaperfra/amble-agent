import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate, insertEvaluation, newId } from '@/lib/db/repo'
import { readPreferences, writePreferences } from '@/lib/pipeline/preferences'
import { rewordAnswer } from '@/lib/pipeline/advisor'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * El bucle del tono.
 *
 * Tres cosas, y están juntas porque en la pantalla son un gesto: leo algo que
 * no me suena bien, digo qué falla, digo cómo lo quiero, y lo veo otra vez.
 *
 * Lo que hace que esto sea rápido —y la razón de que exista— es que **no
 * vuelve a pensar la respuesta**. Los puntos ya están y ya están auditados;
 * lo único que se rehace son las palabras. Una llamada corta en vez de las
 * cuatro de una respuesta entera.
 *
 * Y lo que hace que sea seguro dejarle escribir el tono es que la auditoría
 * no pasa por aquí: lo que el Rep afirma tiene que citar algo del grafo pase
 * lo que pase. Un texto de tono puede cambiar cómo suena; no puede convertir
 * al Rep en un adivino.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as {
    messageId?: unknown
    /** Qué falló. Va a `evaluations`, contra la respuesta concreta. */
    verdict?: unknown
    comment?: unknown
    /** Cómo lo quiere, en sus palabras. */
    tone?: unknown
    /** Si además hay que volver a decirlo ya. */
    reword?: unknown
    /** Y si ese tono se queda para las siguientes. */
    remember?: unknown
  } | null

  const candidate = getOrCreateCandidate()
  const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
  const tone = typeof body?.tone === 'string' ? body.tone.trim().slice(0, 600) : ''

  // ── Lo que falló, apuntado contra esa respuesta ────────────────────────
  //
  // La tabla existía desde el principio y tenía cero filas. Sin esto, cada
  // vuelta de tono deja una impresión; con esto deja un dato que se puede
  // contar por tarea y por versión.
  const verdict = typeof body?.verdict === 'string' ? body.verdict.slice(0, 40) : ''
  if (messageId && verdict) {
    insertEvaluation({
      id: newId('eval'),
      candidate_id: candidate.id,
      target_type: 'rep_answer',
      target_id: messageId,
      verdict,
      comment: typeof body?.comment === 'string' ? body.comment.slice(0, 600) : null,
    })
  }

  // ── El tono, si quiere que se quede ───────────────────────────────────
  if (body?.remember === true) {
    writePreferences(candidate.id, { tone: tone.length > 0 ? tone : null })
  }

  if (body?.reword !== true || !messageId) {
    return NextResponse.json({ ok: true, tone: readPreferences(candidate.id).tone })
  }

  // ── Y otra vez, con esas palabras ─────────────────────────────────────
  const said = await rewordAnswer(candidate.id, messageId, tone)
  if (!said) {
    // La reescritura se tira entera cuando la cuenta de puntos no cuadra: un
    // punto de más sería una afirmación sin fuente colada por la puerta del
    // estilo. Se queda lo que había, que estaba bien.
    return NextResponse.json(
      { error: 'No he podido decirlo de otra manera sin cambiar lo que digo.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true, answer: said.answer, tone: readPreferences(candidate.id).tone })
}

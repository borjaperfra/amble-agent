import { NextResponse } from 'next/server'
import { getOrCreateCandidate } from '@/lib/db/repo'
import {
  deleteFeedbackNote,
  insertFeedbackNote,
  listFeedbackNotes,
  MAX_NOTE_LENGTH,
} from '@/lib/db/feedback'

export const runtime = 'nodejs'

/**
 * La libreta, entera.
 *
 * Sin paginar a propósito: doscientas notas son unos pocos kilobytes y lo
 * que hace útil a esto es poder mirar la lista de arriba abajo sin pedir más.
 * Cuando pasen de doscientas, el problema será otro.
 */
export async function GET() {
  const candidate = getOrCreateCandidate()
  return NextResponse.json({ notes: listFeedbackNotes(candidate.id) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text.length === 0) {
    return NextResponse.json({ error: 'Nothing to write down.' }, { status: 400 })
  }
  if (text.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `That is longer than ${MAX_NOTE_LENGTH} characters.` },
      { status: 400 },
    )
  }

  const candidate = getOrCreateCandidate()
  return NextResponse.json({ note: insertFeedbackNote(candidate.id, text) }, { status: 201 })
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id')?.trim() ?? ''
  if (id.length === 0) {
    return NextResponse.json({ error: 'Which one?' }, { status: 400 })
  }

  const candidate = getOrCreateCandidate()
  if (!deleteFeedbackNote(candidate.id, id)) {
    return NextResponse.json({ error: 'That note is not here.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

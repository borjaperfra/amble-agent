import TelegramAppFlow from '@/components/flows/TelegramAppFlow'
import { safeNext } from '@/app/login/safe-next'

export const dynamic = 'force-dynamic'

// The Mini App (#34): amble inside Telegram, opened from the chat's «amble»
// button or an offer's. Signed in by Telegram itself, then on to the page asked for.
export default async function TelegramAppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const to = (await searchParams).to
  return <TelegramAppFlow to={to ? safeNext(to) : '/opportunities'} />
}

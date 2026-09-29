import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// The reading now happens in the background (pipeline/setup.ts): an old link
// here goes on to wherever the setup is.
export default function ProcessingPage() {
  redirect('/start')
}

'use client'

import { useT } from '@/components/I18nProvider'

// A page that could not be drawn: said calmly, with a way to try again,
// never a blank screen. It comes with every page, so it stays this small and
// uses only the shared styles (a stylesheet of its own would be preloaded on
// every page for nothing).
export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT()
  return (
    <main style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 var(--page-pad)' }}>
      <div role="alert" style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, paddingBottom: '12vh', textAlign: 'center' }}>
        <p className="serif" style={{ fontSize: 'var(--heading-xl)', lineHeight: 1.15, letterSpacing: '-0.02em', textWrap: 'balance' }}>
          {t.common.unreachable}
        </p>
        <button type="button" className="btn" onClick={() => retry()}>
          {t.common.tryAgain}
        </button>
        <a className="text-btn" href="/start">
          amble
        </a>
      </div>
    </main>
  )
}

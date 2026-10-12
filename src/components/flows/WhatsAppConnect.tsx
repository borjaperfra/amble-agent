'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { postJson, requestJson } from '@/components/api'
import { useVisibleInterval } from './useVisibleInterval'
import styles from '@/app/opportunities/opportunities.module.css'

const LOOK_MS = 4000

type Channel = 'whatsapp' | 'telegram'
const ROUTE: Record<Channel, string> = { whatsapp: '/api/whatsapp', telegram: '/api/telegram' }

// Connecting the Rep's chat. WhatsApp: a link opens it with the message
// written, they send it, and the page sees it arrive. Telegram (#18), when
// amble has a bot: a link opens amble's chat, they tap «Start», and the page
// sees it arrive. Connected, amble writes there.
// Compact: only the buttons and what happens, under a line that already said why.
export default function WhatsAppConnect({ linked: initiallyLinked, compact = false }: { linked: boolean; compact?: boolean }) {
  const w = useT().whatsapp
  const [linked, setLinked] = useState<Record<Channel, boolean>>({ whatsapp: initiallyLinked, telegram: false })
  const [telegram, setTelegram] = useState(false)
  const [waiting, setWaiting] = useState<Channel | null>(null)
  const [failed, setFailed] = useState<Channel | null>(null)

  // Whether amble has a Telegram bot, and which chat they are on (the page
  // only knows that they are on one).
  useEffect(() => {
    let current = true
    void requestJson<{ available?: boolean; linked?: boolean }>(ROUTE.telegram).then(({ ok, data }) => {
      if (!current || !ok) return
      setTelegram(Boolean(data.available))
      setLinked((value) => ({ ...value, telegram: Boolean(data.linked) }))
    })
    void requestJson<{ linked?: boolean }>(ROUTE.whatsapp).then(({ ok, data }) => {
      if (current && ok) setLinked((value) => ({ ...value, whatsapp: Boolean(data.linked) }))
    })
    return () => {
      current = false
    }
  }, [])

  // While they are in the other app this tab is in the background: it looks
  // again as soon as they are back, and every few seconds while they are here.
  useVisibleInterval(
    async () => {
      if (!waiting) return
      const { ok, data } = await requestJson<{ linked?: boolean }>(ROUTE[waiting])
      if (ok && data.linked) {
        setLinked((value) => ({ ...value, [waiting]: true }))
        setWaiting(null)
      }
    },
    LOOK_MS,
    waiting !== null,
  )

  async function post(channel: Channel, action: 'start' | 'unlink') {
    setFailed(null)
    const { ok, data } = await postJson<{ url?: string }>(ROUTE[channel], { action })
    if (ok) return data
    setFailed(channel)
    return null
  }

  async function connect(channel: Channel) {
    // Opened now, while the tap still counts as theirs, then pointed at the app.
    const opened = window.open('', '_blank')
    const result = await post(channel, 'start')
    if (!result?.url) {
      opened?.close()
      return
    }
    if (opened) {
      // What opens there cannot reach back into amble.
      opened.opener = null
      opened.location.href = result.url
    } else window.location.href = result.url
    setWaiting(channel)
  }

  const anyLinked = linked.whatsapp || linked.telegram
  const status = linked.telegram ? w.connectedTelegram : waiting === 'telegram' ? w.connectWaitingTelegram : linked.whatsapp ? w.connected : waiting === 'whatsapp' ? w.connectWaiting : null
  const problem = failed === 'telegram' ? w.unavailableTelegram : failed === 'whatsapp' ? w.unavailable : null
  const buttons = (
    <>
      <button type="button" className="btn" onClick={() => void connect('whatsapp')}>
        {w.connect}
      </button>
      {telegram && (
        <button type="button" className="btn btn-quiet" onClick={() => void connect('telegram')}>
          {w.connectTelegram}
        </button>
      )}
    </>
  )

  // On WhatsApp already, Telegram too: amble then writes where they last wrote.
  const telegramToo =
    telegram && linked.whatsapp && !linked.telegram && waiting !== 'telegram' ? (
      <button type="button" className="text-btn" onClick={() => void connect('telegram')}>
        {w.connectTelegramToo}
      </button>
    ) : null

  if (compact) {
    return (
      <div className={styles.whatsappCompact}>
        {anyLinked || waiting ? (
          <>
            <p className={styles.whatsappLead} aria-live="polite">
              {status}
            </p>
            {telegramToo}
          </>
        ) : (
          <div className={styles.whatsappActions}>{buttons}</div>
        )}
        {problem && (
          <p className={styles.error} role="alert">
            {problem}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className={styles.whatsapp}>
      <h2 className={styles.whatsappTitle}>{telegram ? w.connectTitleAny : w.connectTitle}</h2>
      <p className={styles.whatsappLead} aria-live="polite">
        {status ?? (telegram ? w.connectLeadAny : w.connectLead)}
      </p>
      <div className={styles.whatsappActions}>
        {anyLinked
          ? (['whatsapp', 'telegram'] as const)
              .filter((channel) => linked[channel])
              .map((channel) => (
                <button
                  key={channel}
                  type="button"
                  className="text-btn"
                  onClick={async () => {
                    if (await post(channel, 'unlink')) setLinked((value) => ({ ...value, [channel]: false }))
                  }}
                >
                  {w.disconnect}
                  {linked.whatsapp && linked.telegram ? ` (${channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'})` : ''}
                </button>
              ))
          : buttons}
        {telegramToo}
      </div>
      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}

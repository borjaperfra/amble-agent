'use client'

import { useEffect, useState } from 'react'
import Symbol from '@/components/Symbol'
import { useI18n } from '@/components/I18nProvider'
import { postJson } from '@/components/api'
import styles from '@/app/login/login.module.css'

// Telegram's script for Mini Apps: it hands the page what Telegram signed
// (initData), which the server checks to know whose chat opened it.
const TELEGRAM_SCRIPT = 'https://telegram.org/js/telegram-web-app.js'

interface TelegramWebApp {
  initData: string
  ready(): void
  expand(): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

type State = 'opening' | 'notLinked' | 'outside'

export default function TelegramAppFlow({ to }: { to: string }) {
  const { t } = useI18n()
  const [state, setState] = useState<State>('opening')

  useEffect(() => {
    let cancelled = false
    const open = async () => {
      const app = window.Telegram?.WebApp
      if (!app?.initData) {
        if (!cancelled) setState('outside')
        return
      }
      app.ready()
      app.expand()
      const { ok } = await postJson('/api/telegram/webapp', {
        initData: app.initData,
      })
      if (cancelled) return
      if (ok) window.location.replace(to)
      else setState('notLinked')
    }
    if (window.Telegram?.WebApp) {
      void open()
      return () => {
        cancelled = true
      }
    }
    const script = document.createElement('script')
    script.src = TELEGRAM_SCRIPT
    script.async = true
    script.onload = () => void open()
    script.onerror = () => !cancelled && setState('outside')
    document.head.appendChild(script)
    return () => {
      cancelled = true
    }
  }, [to])

  return (
    <main className={styles.page}>
      <div className={styles.stage}>
        <Symbol size={72} breathe={state === 'opening'} className={styles.eye} />
        <div className={styles.step}>
          {state === 'opening' ? (
            <p className={styles.lead} role="status">
              {t.telegramApp.opening}
            </p>
          ) : (
            <>
              <p className={styles.lead}>{state === 'notLinked' ? t.telegramApp.notLinked : t.telegramApp.outside}</p>
              <div className={styles.aside}>
                <a className="text-btn" href="/login">
                  {t.telegramApp.signIn}
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

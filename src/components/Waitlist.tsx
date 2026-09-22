'use client'

import { useState } from 'react'
import styles from './Waitlist.module.css'

/**
 * Un correo, y ya está.
 *
 * Lo que se pidió, literalmente, y conviene defenderlo: cada campo que se
 * añade a un formulario de lista de espera cuesta gente y lo único que mejora
 * son nuestras hojas de cálculo. Quien deja su correo antes de que exista el
 * producto no viene a contarnos su caso.
 *
 * Y lo que dice al terminar no promete una fecha. «Te escribo cuando puedas
 * entrar» es verdad; «en dos semanas» es una fecha que nadie ha decidido y
 * que se convierte en la primera decepción.
 *
 * Contesta lo mismo si ya estabas apuntado, y eso no es pereza: si dijera «ya
 * estabas», cualquiera podría averiguar quién está en la lista probando
 * correos.
 */
export default function Waitlist() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'in'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (email.trim().length === 0 || state === 'sending') return

    setState('sending')
    setError(null)
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'No se ha podido apuntar. Inténtalo otra vez.')
        setState('idle')
        return
      }
      setState('in')
    } catch {
      setError('No se ha podido apuntar. Inténtalo otra vez.')
      setState('idle')
    }
  }

  if (state === 'in') {
    return (
      <section className={styles.box} aria-label="Lista de espera">
        <p className={styles.done} role="status">
          Estás en la lista. Te escribo cuando puedas entrar — no antes, y a nadie más.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.box} aria-label="Lista de espera">
      <p className={styles.lead}>
        Todavía no está abierto. Déjame tu correo y te aviso cuando lo esté.
      </p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label} htmlFor="waitlist-email">
          Tu correo
        </label>
        <div className={styles.row}>
          <input
            id="waitlist-email"
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="go"
            placeholder="tu@correo.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button className={styles.submit} type="submit" disabled={email.trim().length === 0}>
            {state === 'sending' ? 'Un momento…' : 'Avísame'}
          </button>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <p className={styles.small}>Sólo para avisarte de esto. Nada más, y a nadie más.</p>
      </form>
    </section>
  )
}

'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import styles from './LoginForm.module.css'

/**
 * Un campo.
 *
 * Sin explicar qué hay detrás y sin marca: quien llega aquí sin la
 * contraseña no tiene por qué enterarse de a quién pertenece lo que hay
 * dentro.
 */
export default function LoginForm() {
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (password.length === 0 || checking) return

    setChecking(true)
    setError(null)
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        setError('Esa no es.')
        setPassword('')
        return
      }
      // Recarga entera en vez de navegación de cliente: lo que cambia es una
      // cookie, y todo lo que hay detrás se renderiza en el servidor.
      const next = params.get('next')
      window.location.href = next && next.startsWith('/') ? next : '/listening'
    } catch {
      setError('No se ha podido comprobar. Inténtalo otra vez.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label} htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          className={styles.input}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        <button className={styles.submit} type="submit" disabled={password.length === 0}>
          {checking ? 'Un momento…' : 'Entrar'}
        </button>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  )
}

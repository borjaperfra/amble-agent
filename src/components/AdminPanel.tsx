'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from './AdminPanel.module.css'
import type { AdminView } from '@/lib/admin'

/**
 * Todo lo que hay que saber, en una pantalla.
 *
 * Dos reglas, y las dos son sobre no volverse inútil:
 *
 * **Sólo sale lo que existe.** Nada de tarjetas con un cero esperando a que
 * algún día haya algo. Un panel lleno de ceros se deja de mirar, y entonces
 * tampoco se mira el día que el número importa.
 *
 * **Y lo que sale se puede perseguir.** «14 fallos» no sirve; «14 fallos,
 * 8 de ellos "Invalid JSON" en `opportunity_rubric v1`» sí. La diferencia
 * entre un panel y un salpicadero de coche es que en uno se puede tirar del
 * hilo.
 */
export default function AdminPanel({ view }: { view: AdminView }) {
  const [copied, setCopied] = useState(false)

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(view.waitlist.entries.map((row) => row.email).join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const rate = Math.round(view.model.rate * 100)

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Panel</h1>
        <nav className={styles.nav}>
          <Link href="/listening">Rep</Link>
          <Link href="/me">Mapa</Link>
          <Link href="/feedback">Ideas</Link>
          <Link href="/">Portada</Link>
        </nav>
      </header>

      {/* Lo que se ha roto, lo primero y sólo si hay algo. */}
      {view.exceptions.length > 0 ? (
        <section className={`${styles.card} ${styles.alert}`}>
          <h2 className={styles.cardTitle}>Se ha atascado</h2>
          {view.exceptions.map((exception) => (
            <div key={exception.kind} className={styles.row}>
              <p className={styles.rowMain}>{exception.summary}</p>
              {exception.detail ? <p className={styles.rowSub}>{exception.detail}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      <div className={styles.grid}>
        {/* ── Lista de espera ───────────────────────────────────────── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Lista de espera</h2>
          <p className={styles.big}>{view.waitlist.count}</p>
          <p className={styles.rowSub}>
            {view.waitlist.today > 0 ? `${view.waitlist.today} hoy` : 'ninguna hoy'}
          </p>

          {view.waitlist.count > 0 ? (
            <>
              <button type="button" className={`text-btn ${styles.action}`} onClick={copyEmails}>
                {copied ? 'Copiados' : 'Copiar los correos'}
              </button>
              <ul className={styles.list}>
                {view.waitlist.entries.slice(0, 12).map((entry) => (
                  <li key={entry.id} className={styles.listItem}>
                    <span className={styles.mono}>{entry.email}</span>
                    <span className={styles.when}>{entry.created_at.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
              {view.waitlist.count > 12 ? (
                <p className={styles.rowSub}>y {view.waitlist.count - 12} más</p>
              ) : null}
            </>
          ) : (
            <p className={styles.rowSub}>Nadie todavía. El formulario está en la portada.</p>
          )}
        </section>

        {/* ── El modelo ─────────────────────────────────────────────── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>El modelo · 7 días</h2>
          <p className={styles.big}>
            {rate}% <span className={styles.bigNote}>fallan</span>
          </p>
          <p className={styles.rowSub}>
            {view.model.failed} de {view.model.runs} llamadas
          </p>
          <ul className={styles.list}>
            {view.model.byTask.slice(0, 8).map((task) => (
              <li key={`${task.task}-${task.version}`} className={styles.listItem}>
                <span className={styles.mono}>
                  {task.task} <span className={styles.when}>{task.version}</span>
                </span>
                <span className={styles.when}>
                  {task.runs} · {task.failed > 0 ? `${task.failed} fallos · ` : ''}
                  {task.meanSeconds}s
                </span>
              </li>
            ))}
          </ul>
          {view.model.byTask.find((task) => task.worstError) ? (
            <p className={styles.rowSub}>
              Lo que más falla:{' '}
              {view.model.byTask.find((task) => task.worstError)?.worstError}
            </p>
          ) : null}
        </section>

        {/* ── El tono, que es lo que se está iterando ────────────────── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Tono</h2>
          {view.tone ? (
            <p className={styles.quote}>«{view.tone}»</p>
          ) : (
            <p className={styles.rowSub}>Sin tono guardado. Se pone desde una respuesta del Rep.</p>
          )}

          {view.verdicts.length > 0 ? (
            <ul className={styles.list}>
              {view.verdicts.map((verdict) => (
                <li key={verdict.verdict} className={styles.listItem}>
                  <span>{verdict.verdict}</span>
                  <span className={styles.when}>×{verdict.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.rowSub}>
              Ninguna respuesta marcada todavía. El botón está debajo de cada una.
            </p>
          )}

          {view.rewordings.length > 0 ? (
            <>
              <p className={styles.rowSub}>
                {view.rewordings.length} veces «dilo otra vez». Lo último que pediste:
              </p>
              <ul className={styles.list}>
                {view.rewordings.slice(0, 4).map((reword, index) => (
                  <li key={`${reword.at}-${index}`} className={styles.listItem}>
                    <span className={styles.quoteSmall}>«{reword.tone}»</span>
                    <span className={styles.when}>{reword.at.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {/* ── Las ofertas ───────────────────────────────────────────── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Ofertas</h2>
          <p className={styles.big}>{view.pipeline.total}</p>
          <Counts label="Estado" counts={view.pipeline.byStatus} />
          <Counts label="Decisión" counts={view.pipeline.byDecision} />
          <Counts label="De dónde" counts={view.pipeline.byProvenance} />
        </section>

        {/* ── La conversación ───────────────────────────────────────── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Conversación</h2>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              <span>Mensajes suyos</span>
              <span className={styles.when}>{view.conversation.messages}</span>
            </li>
            <li className={styles.listItem}>
              <span>Contestados por el Rep</span>
              <span className={styles.when}>{view.conversation.answered}</span>
            </li>
            <li className={styles.listItem}>
              <span>Consejos guardados</span>
              <span className={styles.when}>{view.conversation.advice}</span>
            </li>
            <li className={styles.listItem}>
              <span>Sin cerrar</span>
              <span className={styles.when}>{view.conversation.openAdvice}</span>
            </li>
          </ul>
          {view.queue.busy ? (
            <p className={styles.rowSub}>
              Cola trabajando{view.queue.running ? `: ${view.queue.running}` : ''}
            </p>
          ) : (
            <p className={styles.rowSub}>Cola al día.</p>
          )}
        </section>

        {/* ── Las ideas ─────────────────────────────────────────────── */}
        <section className={`${styles.card} ${styles.wide}`}>
          <h2 className={styles.cardTitle}>Ideas · {view.notes.length}</h2>
          {view.notes.length > 0 ? (
            <ul className={styles.list}>
              {view.notes.slice(0, 12).map((note) => (
                <li key={note.id} className={styles.listItem}>
                  <span className={styles.noteText}>{note.text}</span>
                  <span className={styles.when}>{note.created_at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.rowSub}>Nada apuntado.</p>
          )}
        </section>
      </div>
    </main>
  )
}

function Counts({ label, counts }: { label: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  return (
    <div className={styles.counts}>
      <p className={styles.countsLabel}>{label}</p>
      <div className={styles.chips}>
        {entries.map(([name, value]) => (
          <span key={name} className={styles.chip}>
            {name} <strong>{value}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

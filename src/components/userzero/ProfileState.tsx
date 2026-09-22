'use client'

import Link from 'next/link'
import styles from './ProfileState.module.css'
import type { MapCompleteness } from '@/lib/view'

export interface ProfileSource {
  kind: string
  label: string
  /** Cuántas hay de ese tipo. Cero significa que no la ha dado. */
  count: number
  /** Qué añadiría, para que decidir si darla no sea a ciegas. */
  adds: string
  /** Todavía no se puede leer, y decirlo es mejor que una casilla muerta. */
  soon?: boolean
  href?: string
}

interface ProfileStateProps {
  completeness: MapCompleteness
  sources: ProfileSource[]
  openGaps: number
}

/**
 * De dónde te conozco, y qué me falta.
 *
 * Todo esto ya se calculaba y estaba **al final de la página**, debajo de
 * dieciséis capacidades. Borja lo dijo así el 22: *«Lo que falta por
 * completar del perfil está muy abajo. No hay botones que te lleven a ello
 * rápido ni una progresión en barra»*. Tenía razón en las tres cosas.
 *
 * La barra no es un porcentaje inventado. Un «70% de perfil completo» es 70%
 * de nada: se elige el denominador para que el número salga bonito, y eso es
 * la métrica de vanidad que el spec prohíbe en §16. Ésta mide una sola cosa y
 * la dice: **cuántas de las cosas que no se saben de él siguen sin saberse**.
 * Eso es lo que le está costando ofertas, y baja cuando cuenta algo.
 *
 * Y las fuentes que aún no se pueden leer salen como lo que son —«todavía no
 * lo leo»— y no como una casilla apagada que promete algo para el mes que
 * viene.
 */
export default function ProfileState({ completeness, sources, openGaps }: ProfileStateProps) {
  const known = completeness.answeredQuestions
  const total = known + openGaps
  const pct = total > 0 ? Math.round((known / total) * 100) : 0

  return (
    <section className={styles.box} aria-label="De dónde te conozco y qué me falta">
      <div className={styles.sources}>
        {sources.map((source) => (
          <div
            key={source.kind}
            className={`${styles.source} ${source.count > 0 ? styles.sourceOn : ''}`}
          >
            <p className={styles.sourceName}>
              {source.label}
              {source.count > 1 ? <span className={styles.sourceCount}> ×{source.count}</span> : null}
            </p>
            <p className={styles.sourceNote}>
              {source.count > 0 ? (
                'Leído'
              ) : source.soon ? (
                'Todavía no lo leo'
              ) : source.href ? (
                <Link href={source.href} className={styles.sourceLink}>
                  Añadir →
                </Link>
              ) : (
                'Sin dar'
              )}
            </p>
            {source.count === 0 ? <p className={styles.sourceAdds}>{source.adds}</p> : null}
          </div>
        ))}
      </div>

      {total > 0 ? (
        <div className={styles.progress}>
          <div className={styles.bar} role="img" aria-label={`${known} de ${total} resueltas`}>
            <div className={styles.fill} style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
          <p className={styles.progressNote}>
            <strong>{openGaps}</strong>{' '}
            {openGaps === 1 ? 'cosa que no sé de ti' : 'cosas que no sé de ti'}
            {known > 0 ? <> · {known} resueltas</> : null}
          </p>
        </div>
      ) : null}

      {completeness.steps.length > 0 ? (
        <div className={styles.steps}>
          {completeness.steps.map((step) => (
            <Link key={step.id} href={step.href} className={styles.step}>
              <span className={styles.stepLabel}>{step.label} →</span>
              <span className={styles.stepDetail}>{step.detail}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}

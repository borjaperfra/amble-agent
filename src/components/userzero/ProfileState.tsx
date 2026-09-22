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
 * dieciséis capacidades, que es como no estar.
 *
 * Aquí había una barra de progreso. La quité al leer el documento de voz, que
 * lo dice con este ejemplo exacto:
 *
 *     No: «Tu perfil está completo al 82%».
 *     Sí: «Sé lo suficiente para empezar a escuchar».
 *
 * Y tenía razón el documento y no yo. Una barra convierte esto en un juego de
 * rellenar perfil —lo de LinkedIn— y la sensación que busca es la contraria:
 * que él siga trabajando mientras otro se ocupa. Un porcentaje le dice que
 * tiene deberes.
 *
 * Lo que queda es el mismo dato dicho como lo diría alguien: cuántas cosas no
 * sé todavía de él. Y el hueco es mío, no suyo — «no tengo evidencia
 * suficiente para entender esto», nunca «te falta esto».
 */
export default function ProfileState({ completeness, sources, openGaps }: ProfileStateProps) {
  const known = completeness.answeredQuestions

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

      <p className={styles.state}>
        {completeness.solid > 0
          ? 'Sé lo suficiente para escuchar.'
          : 'Todavía no sé lo suficiente para escuchar.'}{' '}
        {openGaps > 0 ? (
          <span className={styles.stateGap}>
            Hay {openGaps === 1 ? 'una cosa' : `${openGaps} cosas`} que aún no sé de ti
            {known > 0 ? `, y ${known === 1 ? 'una' : known} que ya me contaste` : ''}.
          </span>
        ) : null}
      </p>

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

import styles from './Exceptions.module.css'
import type { Exception } from '@/lib/pipeline/exceptions'
import type { Language } from '@/lib/copy'

interface ExceptionsProps {
  exceptions: Exception[]
  language: Language
}

/**
 * El parte, y nada cuando no hay parte.
 *
 * Deliberadamente feo de leer en el buen sentido: no lleva icono de alarma ni
 * color de error, porque nada de esto es una emergencia y tratarlo como tal
 * enseña a ignorarlo. Es una nota al pie de la pantalla más silenciosa del
 * producto, y su mejor día es el que no aparece.
 *
 * Lo que sí hace es decir qué pasó en lugar de que algo pasó. «3 ofertas
 * pasaron el filtro y siguen sin decidirse» se puede perseguir; «hubo un
 * error» no.
 */
export default function Exceptions({ exceptions, language }: ExceptionsProps) {
  if (exceptions.length === 0) return null

  return (
    <section
      className={styles.box}
      aria-label={language === 'es' ? 'Lo que se ha atascado' : 'What got stuck'}
    >
      <p className="kicker">{language === 'es' ? 'Se ha atascado' : 'Stuck'}</p>
      <ul className={styles.list}>
        {exceptions.map((exception) => (
          <li key={exception.kind} className={styles.item}>
            <p className={styles.summary}>{exception.summary}</p>
            {exception.detail ? <p className={styles.detail}>{exception.detail}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

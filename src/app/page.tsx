import Link from 'next/link'
import Header from '@/components/Header'
import Reveal from '@/components/Reveal'
import { serverDictionary } from '@/lib/i18n/server'
import styles from './page.module.css'

export default async function Landing() {
  const t = await serverDictionary()
  return (
    <>
      <Header />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <h1 id="hero-title" className={`${styles.heroTitle} ${styles.rise}`}>
            {t.landing.heroLine1}
            <br />
            <em>amble</em> {t.landing.heroLine2}
          </h1>
          <p className={`${styles.heroSub} ${styles.rise} ${styles.delay1}`}>{t.landing.heroSub}</p>
          <div className={`${styles.heroCta} ${styles.rise} ${styles.delay2}`}>
            <Link href="/start" className="btn">
              {t.landing.cta}
            </Link>
            <Link href="/login" className="text-btn">
              {t.landing.haveAccount}
            </Link>
          </div>
        </section>

        <section className={styles.movements} aria-label={t.landing.movementsLabel}>
          {t.landing.movements.map((movement) => (
            <Reveal key={movement.title}>
              <div className={styles.movement}>
                <h2 className={styles.movementTitle}>{movement.title}</h2>
                <p className={styles.movementBody}>{movement.body}</p>
              </div>
            </Reveal>
          ))}
        </section>

        <section className={styles.finale} aria-label={t.landing.finale}>
          <Reveal>
            <h2 className={styles.finaleTitle}>{t.landing.finale}</h2>
            <div className={styles.finaleCta}>
              <Link href="/start" className="text-btn">
                {t.landing.cta}
              </Link>
            </div>
          </Reveal>
        </section>
      </main>
    </>
  )
}

import Header from '@/components/Header'
import Waitlist from '@/components/Waitlist'
import Reveal from '@/components/Reveal'
import styles from './page.module.css'

const movements = [
  {
    title: 'It gets to know you.',
    body: 'Not just where you\u2019ve worked.\nWhat you\u2019ve actually done.',
  },
  {
    title: 'It learns what matters.',
    body: 'Tell your Rep what would make\nsomething worth your attention.',
  },
  {
    title: 'Then it listens.',
    body: 'You keep doing your thing.\nYour Rep will let you know.',
  },
]

export default function Landing() {
  return (
    <>
      <Header />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <h1 id="hero-title" className={`${styles.heroTitle} ${styles.rise}`}>
            I&rsquo;m not looking.
            <br />
            <em>Amble</em> is.
          </h1>
          <p className={`${styles.heroSub} ${styles.rise} ${styles.delay1}`}>
            Meet your professional Rep.
          </p>
          <div className={`${styles.heroCta} ${styles.rise} ${styles.delay2}`}>
{/* La lista de espera donde estaba el botón de entrar.
              Todavía no está abierto: llevar a alguien a «conoce a tu Rep»
              para que se choque con una contraseña es peor que no
              invitarle. */}
            <Waitlist />
          </div>
        </section>

        <section className={styles.movements} aria-label="What Amble does">
          {movements.map((movement) => (
            <Reveal key={movement.title}>
              <div className={styles.movement}>
                <h2 className={styles.movementTitle}>{movement.title}</h2>
                <p className={styles.movementBody}>{movement.body}</p>
              </div>
            </Reveal>
          ))}
        </section>

        <section className={styles.finale} aria-label="Remove applications">
          <Reveal>
            <h2 className={styles.finaleTitle}>Remove applications.</h2>
            <div className={styles.finaleCta}>
              <Waitlist />
            </div>
          </Reveal>
        </section>
      </main>
    </>
  )
}

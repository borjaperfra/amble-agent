import Link from 'next/link'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { serverDictionary } from '@/lib/i18n/server'
import styles from './login/login.module.css'

// An address that leads nowhere: the same quiet door as signing in, in the
// person's language, with the way back.
export default async function NotFound() {
  const t = (await serverDictionary()).common
  return (
    <>
      <Header />
      <main className={styles.page}>
        <div className={styles.stage}>
          <Symbol size={72} className={styles.eye} />
          <h1 className={styles.title}>{t.notFoundTitle}</h1>
          <p className={styles.lead}>{t.notFoundLead}</p>
          <div className={styles.actions}>
            <Link href="/start" className="btn">
              {t.backHome}
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}

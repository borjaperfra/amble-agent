import type { Metadata } from 'next'
import { Inter, Newsreader } from 'next/font/google'
import { I18nProvider } from '@/components/I18nProvider'
import TabEye from '@/components/TabEye'
import { serverDictionary, serverLocale } from '@/lib/i18n/server'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverDictionary()
  return {
    title: t.meta.title,
    description: t.meta.description,
    // The eye, as on amble-web; TabEye swaps it for the closed one in a background tab.
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
  }
}

// The language belongs to the candidate (it also decides what the Rep writes),
// so it is read from their record, not from the URL.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await serverLocale()
  return (
    <html lang={locale} className={`${inter.variable} ${newsreader.variable}`}>
      <body>
        <I18nProvider locale={locale}>
          <TabEye />
          {children}
        </I18nProvider>
      </body>
    </html>
  )
}

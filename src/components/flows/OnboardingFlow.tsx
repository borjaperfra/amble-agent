'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import Header from '@/components/Header'
import { useT } from '@/components/I18nProvider'
import { postJson, requestJson } from '@/components/api'
import styles from '@/app/onboarding/onboarding.module.css'

interface SourceItem {
  id: string
  name: string
  type: string
  status: string
  detail: string | null
}

// Read and usable: just added, or already read into their map.
const isRead = (source: SourceItem) => source.status === 'extracted' || source.status === 'processed'

export default function OnboardingFlow({ initialSources = [] }: { initialSources?: SourceItem[] }) {
  const router = useRouter()
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<SourceItem[]>(initialSources)
  const [githubHandle, setGithubHandle] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  // Which one is being added, to say so where they tapped.
  const [pending, setPending] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  // Said where they tapped: on a phone, the foot of the page is out of sight.
  const [error, setError] = useState<{ at: 'file' | 'github' | 'website' | 'linkedin'; text: string } | null>(null)

  const readableCount = sources.filter(isRead).length
  // The same file given twice comes back as the one already there.
  const keep = (item: SourceItem) => setSources((prev) => [...prev.filter((source) => source.id !== item.id), item])

  async function addFile(file: File) {
    setBusy(true)
    setPending('file')
    setError(null)
    const form = new FormData()
    form.append('file', file)
    const { ok, status, data } = await requestJson<SourceItem>('/api/onboarding/sources', { method: 'POST', body: form })
    if (ok) keep(data)
    else setError({ at: 'file', text: status === 0 ? t.onboarding.fileNotUploaded : (data.error ?? t.onboarding.fileNotStored) })
    setBusy(false)
    setPending(null)
  }

  async function addUrl(kind: 'linkedin' | 'github' | 'website', url: string, reset: () => void) {
    if (!url.trim()) return
    setBusy(true)
    setPending(kind)
    setError(null)
    const { ok, data } = await postJson<SourceItem>('/api/onboarding/sources', { kind, url })
    if (ok) {
      keep(data)
      reset()
    } else setError({ at: kind, text: data.error ?? t.onboarding.urlNotStored })
    setBusy(false)
    setPending(null)
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{t.onboarding.title}</h1>
        <p className={styles.body}>
          {t.onboarding.body}
        </p>
        {/* Back here because nothing they shared could be used: why, first. */}
        {readableCount === 0 && sources.some((source) => source.status === 'rejected') && (
          <p className={styles.errorNotice} role="status">
            {t.onboarding.nothingUsable}
          </p>
        )}

        <div className={styles.sources}>
          {/* Word files too: whoever picks one is told how to make it a PDF. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.doc,.docx"
            className="visually-hidden"
            aria-label={t.onboarding.cvUploadLabel}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void addFile(file)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className={styles.fileDrop}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label={t.onboarding.cvAddLabel}
          >
            <span className={styles.fileDropMain}>
              <span className={styles.fileDropLabel}>{t.onboarding.cv}</span>
              <span className={styles.fileDropHint}>
                {pending === 'file' ? t.onboarding.reading : t.onboarding.uploadHint}
              </span>
            </span>
            <span className={styles.rowRight}>
              <span className={styles.rowAction}>{t.common.add}</span>
            </span>
          </button>
          {error?.at === 'file' && (
            <p className={styles.errorNotice} role="alert">
              {error.text}
            </p>
          )}

          {sources.map((source) => (
            <div
              key={source.id}
              className={`${styles.row} ${isRead(source) ? styles.rowConnected : ''} ${styles.enter}`}
            >
              <span className={styles.rowLabel}>{source.name}</span>
              <span className={styles.rowRight}>
                {isRead(source) ? (
                  <>
                    <span className={styles.rowIdentifier}>{t.onboarding.read}</span>
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  </>
                ) : (
                  <span className={styles.rowIdentifier}>{source.detail ?? source.status}</span>
                )}
              </span>
              {/* Read, with something to know about it: hidden text taken out,
                  what was read of a GitHub profile. */}
              {isRead(source) && source.detail && <span className={styles.rowNote}>{source.detail}</span>}
            </div>
          ))}

          <div className={`${styles.row} ${styles.enter}`}>
            <span className={styles.rowLabel}>GitHub</span>
            <span className={styles.rowRight}>
              <input
                type="text"
                className={styles.urlInput}
                placeholder={t.onboarding.githubPlaceholder}
                aria-label={t.onboarding.githubLabel}
                value={githubHandle}
                onChange={(event) => setGithubHandle(event.target.value)}
              />
              <button
                type="button"
                className="text-btn"
                disabled={busy || !githubHandle.trim()}
                onClick={() => {
                  const raw = githubHandle.trim()
                  const url = raw.startsWith('http') ? raw : `https://github.com/${raw}`
                  addUrl('github', url, () => setGithubHandle(''))
                }}
              >
                {pending === 'github' ? t.onboarding.reading : t.common.add}
              </button>
            </span>
          </div>
          {error?.at === 'github' && (
            <p className={styles.errorNotice} role="alert">
              {error.text}
            </p>
          )}

          <div className={`${styles.row} ${styles.enter}`}>
            <span className={styles.rowLabel}>LinkedIn</span>
            {/* A profile URL cannot be read; the profile's own PDF can. */}
            <span className={styles.rowHint}>{t.onboarding.linkedinHint}</span>
          </div>

          <div className={`${styles.row} ${styles.enter}`}>
            <span className={styles.rowLabel}>{t.onboarding.website}</span>
            <span className={styles.rowRight}>
              <input
                type="url"
                className={styles.urlInput}
                placeholder="https://"
                aria-label={t.onboarding.websiteLabel}
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
              />
              <button
                type="button"
                className="text-btn"
                disabled={busy || !websiteUrl.trim()}
                onClick={() => addUrl('website', websiteUrl, () => setWebsiteUrl(''))}
              >
                {pending === 'website' ? t.onboarding.reading : t.common.add}
              </button>
            </span>
          </div>
          {error?.at === 'website' && (
            <p className={styles.errorNotice} role="alert">
              {error.text}
            </p>
          )}
        </div>

        <p className={styles.notice}>
          {t.onboarding.notice}
        </p>

        <div className={styles.footer}>
          <button
            type="button"
            className={`btn ${styles.continue}`}
            disabled={readableCount === 0 || busy || leaving}
            onClick={async () => {
              setLeaving(true)
              // Reading starts now, in the background; meanwhile, what they are looking for.
              await postJson('/api/onboarding/process', { stage: 'start' })
              // The next step they have not taken: what they are looking for
              // the first time; the questions when they come back to add a CV.
              router.push('/start')
            }}
          >
            {leaving ? t.onboarding.starting : t.common.continue}
          </button>
          {/* Why it cannot be pressed yet, where they are looking. */}
          {readableCount === 0 && !busy && <p className={styles.continueHint}>{t.onboarding.continueHint}</p>}
        </div>
      </main>
    </>
  )
}

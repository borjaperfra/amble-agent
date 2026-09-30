'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import Header from '@/components/Header'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/onboarding/onboarding.module.css'

interface SourceItem {
  id: string
  name: string
  type: string
  status: string
  detail: string | null
}

export default function OnboardingFlow() {
  const router = useRouter()
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<SourceItem[]>([])
  const [githubHandle, setGithubHandle] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  // Which one is being added, to say so where they tapped.
  const [pending, setPending] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readableCount = sources.filter((source) => source.status === 'extracted').length

  async function addFile(file: File) {
    setBusy(true)
    setPending('file')
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/onboarding/sources', { method: 'POST', body: form })
      const data = (await response.json()) as SourceItem & { error?: string }
      if (!response.ok) {
        setError(data.error ?? t.onboarding.fileNotStored)
        return
      }
      setSources((prev) => [...prev, data])
    } catch {
      setError(t.onboarding.fileNotUploaded)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  async function addUrl(kind: 'linkedin' | 'github' | 'website', url: string, reset: () => void) {
    if (!url.trim()) return
    setBusy(true)
    setPending(kind)
    setError(null)
    try {
      const response = await fetch('/api/onboarding/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, url }),
      })
      const data = (await response.json()) as SourceItem & { error?: string }
      if (!response.ok) {
        setError(data.error ?? t.onboarding.urlNotStored)
        return
      }
      setSources((prev) => [...prev, data])
      reset()
    } catch {
      setError(t.onboarding.urlNotStored)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{t.onboarding.title}</h1>
        <p className={styles.body}>
          {t.onboarding.body}
        </p>

        <div className={styles.sources}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
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

          {sources.map((source) => (
            <div
              key={source.id}
              className={`${styles.row} ${source.status === 'extracted' ? styles.rowConnected : ''} ${styles.enter}`}
            >
              <span className={styles.rowLabel}>{source.name}</span>
              <span className={styles.rowRight}>
                {source.status === 'extracted' ? (
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
        </div>

        <p className={styles.notice}>
          {t.onboarding.notice}
        </p>

        {error && (
          <p className={styles.errorNotice} role="alert">
            {error}
          </p>
        )}

        <div className={styles.footer}>
          <button
            type="button"
            className={`btn ${styles.continue}`}
            disabled={readableCount === 0 || busy || leaving}
            onClick={async () => {
              setLeaving(true)
              // Reading starts now, in the background; meanwhile, what they are looking for.
              await fetch('/api/onboarding/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: 'start' }),
              }).catch(() => undefined)
              router.push('/me/intent')
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

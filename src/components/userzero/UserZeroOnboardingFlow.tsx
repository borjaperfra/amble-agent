'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import styles from '@/app/onboarding/onboarding.module.css'

interface SourceItem {
  id: string
  name: string
  type: string
  status: string
  detail: string | null
}

export default function UserZeroOnboardingFlow() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<SourceItem[]>([])
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [githubHandle, setGithubHandle] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // dragleave fires for every child element the pointer crosses, so the depth
  // has to be counted rather than toggled.
  const dragDepth = useRef(0)

  const readableCount = sources.filter((source) => source.status === 'extracted').length

  async function addFile(file: File) {
    setBusy(true)
    setError(null)
    setUploading((prev) => [...prev, file.name])
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/onboarding/sources', { method: 'POST', body: form })
      const data = (await response.json()) as SourceItem & { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'The file could not be stored.')
        return
      }
      setSources((prev) => [...prev, data])
    } catch {
      setError('The file could not be uploaded.')
    } finally {
      setUploading((prev) => prev.filter((name) => name !== file.name))
      setBusy(false)
    }
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      await addFile(file)
    }
  }

  async function addUrl(kind: 'linkedin' | 'github' | 'website', url: string, reset: () => void) {
    if (!url.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/onboarding/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, url }),
      })
      const data = (await response.json()) as SourceItem & { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'The URL could not be stored.')
        return
      }
      setSources((prev) => [...prev, data])
      reset()
    } catch {
      setError('The URL could not be stored.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header />
      <main
        className={styles.page}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          void addFiles(event.dataTransfer.files)
        }}
      >
        <h1 className={styles.title}>Let&rsquo;s build your Rep.</h1>
        <p className={styles.body}>
          {'Start with what already exists.\nI\u2019ll read it before asking you anything.'}
        </p>

        <div className={styles.sources}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md"
            className="visually-hidden"
            aria-label="Upload your CV as a PDF, Word or text file"
            onChange={(event) => {
              const files = event.target.files
              if (files?.length) void addFiles(files)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className={`${styles.fileDrop} ${dragging ? styles.fileDropActive : ''}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Add your CV as a PDF, Word or text file"
          >
            <span className={styles.fileDropMain}>
              <span className={styles.fileDropLabel}>CV</span>
              <span className={styles.fileDropHint}>
                {dragging
                  ? 'Drop it here.'
                  : busy
                    ? 'Reading it...'
                    : 'Drop a file here, or pick one. PDF, Word or text.'}
              </span>
            </span>
            <span className={styles.rowRight}>
              <span className={styles.rowAction}>Add →</span>
            </span>
          </button>

          {uploading.map((name) => (
            <div key={name} className={`${styles.uploadingRow} ${styles.enter}`} role="status">
              <StatusDot />
              <span>Reading {name}...</span>
            </div>
          ))}

          {sources.map((source) => (
            <div
              key={source.id}
              className={`${styles.row} ${source.status === 'extracted' ? styles.rowConnected : ''} ${styles.enter}`}
            >
              <span className={styles.rowLabel}>{source.name}</span>
              <span className={styles.rowRight}>
                {source.status === 'extracted' ? (
                  <>
                    <span className={styles.rowIdentifier}>read</span>
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
                placeholder="username"
                aria-label="GitHub username or profile URL"
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
                Add →
              </button>
            </span>
          </div>

          <div className={`${styles.row} ${styles.enter}`}>
            <span className={styles.rowLabel}>LinkedIn</span>
            <span className={styles.rowRight}>
              <input
                type="url"
                className={styles.urlInput}
                placeholder="Profile URL"
                aria-label="LinkedIn profile URL"
                value={linkedinUrl}
                onChange={(event) => setLinkedinUrl(event.target.value)}
              />
              <button
                type="button"
                className="text-btn"
                disabled={busy || !linkedinUrl.trim()}
                onClick={() => addUrl('linkedin', linkedinUrl, () => setLinkedinUrl(''))}
              >
                Add →
              </button>
            </span>
          </div>

          <div className={`${styles.row} ${styles.enter}`}>
            <span className={styles.rowLabel}>Website</span>
            <span className={styles.rowRight}>
              <input
                type="url"
                className={styles.urlInput}
                placeholder="https://"
                aria-label="Personal website URL"
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
              />
              <button
                type="button"
                className="text-btn"
                disabled={busy || !websiteUrl.trim()}
                onClick={() => addUrl('website', websiteUrl, () => setWebsiteUrl(''))}
              >
                Add →
              </button>
            </span>
          </div>
        </div>

        <p className={styles.notice}>
          A readable CV is what powers this first real test. LinkedIn and websites help less.
        </p>

        {error && (
          <p className={styles.errorNotice} role="alert">
            {error}
          </p>
        )}

        <div className={styles.footer}>
          <p className={styles.footerNote}>
            {readableCount === 0
              ? 'Add something I can read and the button wakes up.'
              : readableCount === 1
                ? "That's enough to start. Hit continue and I'll read it properly."
                : `${readableCount} sources ready. Hit continue and I'll read them properly.`}
          </p>
          <button
            type="button"
            className="btn"
            disabled={readableCount === 0 || busy}
            onClick={() => router.push('/onboarding/processing')}
          >
            Continue →
          </button>
        </div>
      </main>
    </>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useSyncExternalStore } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/login/login.module.css'

type Phase = 'email' | 'code'
type ErrorKey = 'invalidEmail' | 'tooMany' | 'failed' | 'wrongCode' | 'expiredCode' | 'invitationUsed' | 'betaFull'

// What the auth routes answer, as the screen says it.
const ERRORS: Record<string, ErrorKey> = {
  invalid_email: 'invalidEmail',
  too_many: 'tooMany',
  failed: 'failed',
  wrong: 'wrongCode',
  expired: 'expiredCode',
  invitation_used: 'invitationUsed',
  beta_full: 'betaFull',
}

const CODE_LENGTH = 6
// A wrong code: the eye narrows, the figures fade, and the field is ready again.
const NO_MS = 1400
const FADE_MS = 320
// Signed in: the eye closes and the page fades before the next one opens.
const LEAVE_MS = 620
// Long enough to read "welcome back" before the page fades.
const GREET_MS = 1100
// Pasted figures arrive one after another, this far apart.
const CASCADE_MS = 70
// The browser remembers the last address that signed in here, so the next
// time it is already written. Only in this browser, never sent anywhere.
const LAST_EMAIL = 'amble-last-email'

function rememberedEmail(): string {
  try {
    return window.localStorage.getItem(LAST_EMAIL) ?? ''
  } catch {
    return ''
  }
}

const noSubscription = () => () => undefined

function rememberEmail(email: string): void {
  try {
    window.localStorage.setItem(LAST_EMAIL, email)
  } catch {
    // Storage unavailable: the next visit simply starts empty.
  }
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

// The email, marked where the sentence names it: that is where the code went.
function withEmail(sentence: string, email: string) {
  const at = sentence.indexOf(email)
  if (!email || at < 0) return sentence
  return (
    <>
      {sentence.slice(0, at)}
      <span className={styles.email}>{email}</span>
      {sentence.slice(at + email.length)}
    </>
  )
}

// Signing in, or, with an invitation, creating an account: the same two
// steps, email then code. One eye stays with you through both: it looks at
// what you write, blinks when the code is on its way, listens while it waits,
// narrows at a wrong code, and closes when you are in, to wake on the next page.
export default function LoginFlow({ next, invitation = null }: { next: string; invitation?: string | null }) {
  const router = useRouter()
  const t = useT()
  const [phase, setPhase] = useState<Phase>('email')
  // Only the browser knows it: empty while rendering on the server.
  const remembered = useSyncExternalStore(noSubscription, rememberedEmail, () => '')
  // Until the person writes, the address shown is the one this browser remembers.
  const [typed, setTyped] = useState<string | null>(null)
  const email = typed ?? remembered
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [gaze, setGaze] = useState<HTMLElement | null>(null)
  const [blinks, setBlinks] = useState(0)
  const [lid, setLid] = useState(0)
  const [clearing, setClearing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [greeting, setGreeting] = useState<string | null>(null)
  const [cascade, setCascade] = useState(false)
  // The first step arrives with the page; later ones arrive on their own.
  const [moved, setMoved] = useState(false)
  const verifying = useRef(false)

  async function post(path: string, body: unknown): Promise<{ error: string | null; data: Record<string, unknown> }> {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (response.ok) return { error: null, data }
      return { error: typeof data.error === 'string' ? data.error : 'failed', data }
    } catch {
      return { error: 'failed', data: {} }
    }
  }

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    const { error: failure } = await post('/api/auth/code', invitation ? { email, invitation } : { email })
    setBusy(false)
    if (failure) {
      setError(ERRORS[failure] ?? 'failed')
      return
    }
    // "Got it": one blink as the next step arrives.
    setBlinks((count) => count + 1)
    setCode('')
    setMoved(true)
    setPhase('code')
  }

  async function verify(value: string) {
    if (verifying.current || value.length !== CODE_LENGTH) return
    verifying.current = true
    setBusy(true)
    setError(null)
    const { error: failure, data } = await post('/api/auth/verify', { email, code: value })
    if (!failure) {
      rememberEmail(email.trim().toLowerCase())
      // Someone coming back is greeted by name; a new account goes on to meet its Rep.
      const first = typeof data.name === 'string' ? data.name.trim().split(/\s+/)[0] : ''
      if (first && data.joined !== true) {
        setGreeting(t.login.welcomeBack(first))
        await wait(GREET_MS)
      }
      setGaze(null)
      setLid(1)
      setLeaving(true)
      await wait(LEAVE_MS)
      router.replace(next)
      router.refresh()
      return
    }
    // A quiet no: the eye narrows, the figures fade, the field empties.
    setLid(0.55)
    setClearing(true)
    await wait(FADE_MS)
    setCode('')
    setClearing(false)
    setError(ERRORS[failure] ?? 'wrongCode')
    verifying.current = false
    setBusy(false)
    window.setTimeout(() => setLid(0), NO_MS - FADE_MS)
  }

  // A complete code is sent as soon as it is there: no button to find. Only
  // figures count: spaces, dashes or words pasted around them are dropped
  // before counting, so "123 456" is the whole code.
  function typeCode(raw: string) {
    const value = raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
    // Several figures at once were pasted: they arrive in turn.
    setCascade(value.length - code.length > 1)
    setCode(value)
    if (error) setError(null)
    if (value.length === CODE_LENGTH) void verify(value)
  }

  // While it waits, the button keeps its words and a fine line crosses it;
  // a screen reader hears what is happening instead.
  // The caret is not drawn, so it always sits after the last figure: typing
  // adds at the end and Backspace takes the last one away, whatever was
  // clicked. Ctrl or Cmd with Backspace clears the field.
  function keepCaretAtEnd(event: React.SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const end = input.value.length
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end)
  }

  function editCode(event: React.KeyboardEvent<HTMLInputElement>) {
    if (busy || (event.key !== 'Backspace' && event.key !== 'Delete')) return
    event.preventDefault()
    const value = event.ctrlKey || event.metaKey || event.altKey ? '' : code.slice(0, -1)
    setCascade(false)
    setCode(value)
    if (error) setError(null)
  }

  const tracing = (label: string, busyLabel: string) => (
    <>
      <span className={busy ? `${styles.buttonText} ${styles.tracing}` : styles.buttonText} aria-hidden={busy || undefined}>
        {label}
      </span>
      {busy && (
        <span className="visually-hidden" role="status">
          {busyLabel}
        </span>
      )}
    </>
  )

  function backToEmail() {
    setMoved(true)
    setPhase('email')
    setCode('')
    setError(null)
    setLid(0)
  }

  const errorText = error ? t.login[error] : null
  const look = {
    onFocus: (event: React.FocusEvent<HTMLInputElement>) => setGaze(event.currentTarget),
    onBlur: () => setGaze(null),
  }

  return (
    <>
      <Header />
      <main className={leaving ? `${styles.page} ${styles.leaving}` : styles.page}>
        <div className={styles.stage}>
          <Symbol size={72} watch breathe={phase === 'code'} gaze={gaze} blinkSignal={blinks} lid={lid} className={styles.eye} />

          {phase === 'email' ? (
            <div className={moved ? `${styles.step} ${styles.enter}` : styles.step} key="email">
              <h1 className={styles.title}>{invitation ? t.login.joinTitle : t.login.title}</h1>
              <p className={styles.lead}>{invitation ? t.login.joinLead : t.login.lead}</p>
              <form className={styles.form} onSubmit={(event) => void sendCode(event)} noValidate>
                <label className={styles.label} htmlFor="login-email">
                  {t.login.emailLabel}
                </label>
                <div className={styles.row}>
                  <input
                    id="login-email"
                    className={styles.input}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    spellCheck={false}
                    required
                    autoFocus
                    value={email}
                    aria-invalid={error === 'invalidEmail' || undefined}
                    aria-describedby={errorText ? 'login-error' : undefined}
                    {...look}
                    onChange={(event) => {
                      setTyped(event.target.value)
                      if (error) setError(null)
                    }}
                  />
                  <button type="submit" className="btn" disabled={busy}>
                    {tracing(t.login.send, t.login.sending)}
                  </button>
                </div>
                {errorText && (
                  <p className={styles.error} id="login-error" role="alert">
                    {errorText}
                  </p>
                )}
              </form>
            </div>
          ) : (
            <div className={`${styles.step} ${styles.enter}`} key="code">
              <h1 className={styles.title} key={greeting ?? 'code'}>
                {greeting ?? t.login.codeTitle}
              </h1>
              <p className={styles.lead}>{withEmail(t.login.codeLead(email.trim()), email.trim())}</p>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault()
                  void verify(code)
                }}
              >
                <label className="visually-hidden" htmlFor="login-code">
                  {t.login.codeLabel}
                </label>
                <div className={styles.codeField}>
                  <input
                    id="login-code"
                    className={`${styles.input} ${styles.code}`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    readOnly={busy}
                    value={code}
                    aria-invalid={error === 'wrongCode' || error === 'expiredCode' || undefined}
                    aria-describedby={errorText ? 'login-error' : undefined}
                    {...look}
                    onChange={(event) => typeCode(event.target.value)}
                    onKeyDown={editCode}
                    onSelect={keepCaretAtEnd}
                  />
                  {/* What the field shows: six places, each figure settling into its own. */}
                  <span className={clearing ? `${styles.figures} ${styles.clearing}` : styles.figures} aria-hidden="true">
                    {Array.from({ length: CODE_LENGTH }, (_, index) =>
                      code[index] ? (
                        <span
                          key={`d${index}-${code[index]}`}
                          className={styles.figure}
                          style={cascade ? { animationDelay: `${index * CASCADE_MS}ms` } : undefined}
                        >
                          {code[index]}
                        </span>
                      ) : (
                        <span key={`p${index}`} className={index === code.length ? `${styles.place} ${styles.next}` : styles.place}>
                          ·
                        </span>
                      ),
                    )}
                  </span>
                </div>
                {errorText && (
                  <p className={styles.error} id="login-error" role="alert">
                    {errorText}
                  </p>
                )}
                <button type="submit" className={`btn ${styles.submit}`} disabled={busy || code.length !== CODE_LENGTH}>
                  {tracing(t.login.verify, t.login.verifying)}
                </button>
              </form>
              <div className={styles.aside}>
                <button type="button" className="text-btn" disabled={busy} onClick={() => void sendCode()}>
                  {t.login.resend}
                </button>
                <button type="button" className="text-btn" disabled={busy} onClick={backToEmail}>
                  {t.login.otherEmail}
                </button>
              </div>
            </div>
          )}
        </div>

        {!invitation && (
          <p className={styles.note}>
            {t.login.noAccount} <a href="https://amble.fyi">{t.login.waitlist}</a>
          </p>
        )}
      </main>
    </>
  )
}

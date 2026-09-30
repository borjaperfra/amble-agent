// A browser in the cloud for one application (Browserbase), where there is
// no browser of our own (the server). The candidate watches and finishes the
// form in its live view, inside amble's page: the live view's own address
// lets whoever has it drive the browser, so it is never sent anywhere, only
// shown to the signed-in candidate.
//
// BROWSERBASE_API_KEY turns it on; the project is the key's own.

const API = 'https://api.browserbase.com/v1'
// Where the data stays: the EU.
const REGION = 'eu-central-1'

export function cloudBrowserConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY)
}

function headers(): Record<string, string> {
  return { 'X-BB-API-Key': process.env.BROWSERBASE_API_KEY ?? '', 'Content-Type': 'application/json' }
}

export interface CloudSession {
  id: string
  connectUrl: string
}

export async function createCloudSession(minutes: number, candidateId: string): Promise<CloudSession> {
  const response = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      region: REGION,
      timeout: Math.min(21_600, Math.max(60, minutes * 60)),
      userMetadata: { candidate: candidateId },
      browserSettings: {
        viewport: { width: 1280, height: 900 },
        // A challenge on the form is theirs to answer, in the live view.
        solveCaptchas: false,
        // A recording would keep their answers at a third party.
        recordSession: false,
        logSession: false,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Browserbase session: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
  const session = (await response.json()) as { id: string; connectUrl: string }
  return { id: session.id, connectUrl: session.connectUrl }
}

// The interactive view of the session, without Browserbase's bar.
export async function liveViewOf(sessionId: string): Promise<string | null> {
  const response = await fetch(`${API}/sessions/${sessionId}/debug`, { headers: headers(), signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!response?.ok) return null
  const debug = (await response.json()) as { debuggerFullscreenUrl?: string }
  return debug.debuggerFullscreenUrl ? `${debug.debuggerFullscreenUrl}&navbar=false` : null
}

// Ends the session at once (closing the connection may leave it running
// until its timeout).
export async function releaseCloudSession(sessionId: string): Promise<void> {
  await fetch(`${API}/sessions/${sessionId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined)
}

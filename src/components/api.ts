// The one way the screens talk to the route handlers. It never throws: a
// failed request, or no connection at all (status 0), comes back as not ok,
// with whatever the route said about it in data.error.

export type ApiResult<T> = { ok: boolean; status: number; data: T & { error?: string } }

export async function requestJson<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, init)
    const data = (await response.json().catch(() => ({}))) as T & { error?: string }
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: {} as T & { error?: string } }
  }
}

export function postJson<T = Record<string, unknown>>(path: string, body: unknown): Promise<ApiResult<T>> {
  return requestJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

// An action on an application (fill, status, submit, cancel, live): what it
// answered, or an error with the route's reason.
export async function applicationAction<T = Record<string, unknown>>(body: unknown): Promise<T> {
  const { ok, data } = await postJson<T>('/api/applications', body)
  if (!ok) throw new Error(data.error || 'failed')
  return data
}

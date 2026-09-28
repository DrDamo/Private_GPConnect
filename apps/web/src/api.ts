// Small fetch wrapper: JSON in, JSON out, errors as values (never thrown).

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; details: Record<string, unknown> }

export async function api<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return { ok: true, data: data as T }
    const { error, message, ...details } = data
    return {
      ok: false,
      status: res.status,
      error: String(error ?? 'error'),
      message: String(message ?? `Request failed (${res.status})`),
      details,
    }
  } catch (err) {
    return { ok: false, status: 0, error: 'network', message: err instanceof Error ? err.message : String(err), details: {} }
  }
}

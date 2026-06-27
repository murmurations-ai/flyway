/**
 * Shared HTTPS fetch concerns for flyway's remote operations (v0.2).
 *
 * Two consumers, one audited path: directory fetch (`flyway_discover`,
 * ADR-0010) and peer-identity resolution (`flyway_recognize` over a
 * `did:web` URL). Both are pre-trust reads — a remote document is verified
 * cryptographically *after* it is fetched, never trusted because of where
 * it came from — so the hardening here is about transport safety, not
 * authenticity: HTTPS-only, no private/loopback targets (SSRF), a size cap
 * and a timeout (DoS), and redirect re-validation.
 *
 * Residual risk (documented, not yet closed): a public hostname that DNS-
 * resolves to a private address (rebinding). v0.2 accepts this; pinning /
 * resolve-then-connect is reserved for a later hardening pass. The blast
 * radius is bounded by these fetches being pre-trust.
 */

export interface HttpsFetchDeps {
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Max bytes accepted from the response. Default 5 MiB. */
  readonly maxBytes?: number
  /** Fetch timeout in ms. Default 10_000. */
  readonly timeoutMs?: number
  /** Allow loopback/private hosts (local testing only). Default false. */
  readonly allowPrivate?: boolean
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_TIMEOUT_MS = 10_000

/** Hostnames / IP literals we refuse to fetch from (SSRF guard). */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '0.0.0.0' || h === '::') return true
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true
  // IPv4 literals in loopback / private / link-local ranges.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

/**
 * Assert a URL is safe to fetch from: HTTPS, and not pointed at a
 * loopback / private / link-local host. `allowPrivate` opts out for local
 * testing. Throws synchronously with a diagnosable message.
 */
export function assertPublicHttpsUrl(rawUrl: string, allowPrivate = false): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`flyway: '${rawUrl}' is not a valid URL`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`flyway: fetch is HTTPS-only (got ${url.protocol})`)
  }
  if (!allowPrivate && isBlockedHost(url.hostname)) {
    throw new Error(
      `flyway: refusing to fetch from a private/loopback host (${url.hostname}). ` +
        'Pass allowPrivate to override for local testing.',
    )
  }
}

/** Read a response body, aborting if it exceeds maxBytes (DoS guard). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = (await reader.read()) as {
      done: boolean
      value?: Uint8Array
    }
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`flyway: response exceeds ${String(maxBytes)}-byte cap`)
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Fetch text over HTTPS with the full guard: URL safety (pre-fetch),
 * size cap, timeout, and post-redirect re-validation. Asserts the URL is
 * safe BEFORE any network call, so a blocked host never reaches `fetch`.
 */
export async function fetchTextOverHttps(
  url: string,
  deps: HttpsFetchDeps = {},
  accept = 'application/json',
): Promise<string> {
  assertPublicHttpsUrl(url, deps.allowPrivate ?? false)
  const fetchImpl = deps.fetchImpl ?? fetch
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ctrl = new AbortController()
  const timer = setTimeout(() => {
    ctrl.abort()
  }, timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: accept },
    })
    if (!res.ok) {
      throw new Error(`flyway: fetch failed (HTTP ${String(res.status)}) for ${url}`)
    }
    // A redirect must not have downgraded us off a public HTTPS host.
    if (res.url && res.url !== url) assertPublicHttpsUrl(res.url, deps.allowPrivate ?? false)
    return await readCapped(res, maxBytes)
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`flyway: fetch timed out after ${String(timeoutMs)}ms for ${url}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

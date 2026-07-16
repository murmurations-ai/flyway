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
 * resolves to a private address (rebinding). The guard is lexical — it
 * blocks private/loopback IP *literals* (IPv4 and IPv6, including IPv4-
 * mapped / NAT64 / 6to4 embeddings) and `localhost`, but does not re-check
 * the address a public hostname actually resolves to. v0.2 accepts this;
 * resolve-then-connect / pinning is reserved for a later hardening pass.
 * The blast radius is bounded by these fetches being pre-trust.
 */

import { isIP } from 'node:net'

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

/** Is an IPv4 (a.b.c.d) in a loopback / private / link-local / unspecified range? */
function isBlockedIpv4(a: number, b: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true // loopback, private, unspecified
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  return false
}

/**
 * Parse a validated IPv6 literal into 16 bytes, resolving `::` compression
 * and any trailing embedded IPv4 (e.g. `::ffff:127.0.0.1`). Returns null if
 * the input is not a well-formed IPv6 address.
 */
function ipv6ToBytes(input: string): number[] | null {
  if (isIP(input) !== 6) return null
  let s = input
  let v4: [number, number, number, number] | null = null
  const m = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    v4 = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]
    s = `${String(m[1])}0:0` // placeholder two hextets; overwritten with v4 below
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : []
  const groups =
    halves.length === 2
      ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
      : left
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    const v = parseInt(g || '0', 16)
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  if (v4) {
    bytes[12] = v4[0]
    bytes[13] = v4[1]
    bytes[14] = v4[2]
    bytes[15] = v4[3]
  }
  return bytes
}

/** Is an IPv6 (16 bytes) in a blocked range, including embedded-IPv4 forms? */
function isBlockedIpv6(bytes: number[]): boolean {
  const at = (i: number): number => bytes[i] ?? 0
  const allZeroUpTo = (n: number) => bytes.slice(0, n).every((x) => x === 0)
  if (allZeroUpTo(15) && at(15) === 1) return true // ::1 loopback
  if (bytes.every((x) => x === 0)) return true // :: unspecified
  if (at(0) === 0xff) return true // ff00::/8 multicast
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return true // fe80::/10 link-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0xc0) return true // fec0::/10 site-local (deprecated)
  if ((at(0) & 0xfe) === 0xfc) return true // fc00::/7 unique-local
  // IPv4-mapped ::ffff:a.b.c.d
  if (allZeroUpTo(10) && at(10) === 0xff && at(11) === 0xff) return isBlockedIpv4(at(12), at(13))
  // NAT64 64:ff9b::/96
  if (
    at(0) === 0x00 &&
    at(1) === 0x64 &&
    at(2) === 0xff &&
    at(3) === 0x9b &&
    bytes.slice(4, 12).every((x) => x === 0)
  ) {
    return isBlockedIpv4(at(12), at(13))
  }
  // 6to4 2002:V4ADDR::/16 — embedded IPv4 in bytes 2..5
  if (at(0) === 0x20 && at(1) === 0x02) return isBlockedIpv4(at(2), at(3))
  // IPv4-compatible ::a.b.c.d (deprecated); :: and ::1 handled above
  if (allZeroUpTo(12)) return isBlockedIpv4(at(12), at(13))
  return false
}

/** Hostnames / IP literals we refuse to fetch from (SSRF guard). */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  const kind = isIP(h)
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number, number, number]
    return isBlockedIpv4(a, b)
  }
  if (kind === 6) {
    const bytes = ipv6ToBytes(h)
    if (bytes) return isBlockedIpv6(bytes)
  }
  // A non-literal hostname is allowed; its resolved address is not re-checked
  // (DNS-rebinding residual risk, documented in the module header).
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

const MAX_REDIRECTS = 5

/**
 * Fetch text over HTTPS with the full guard: every hop's URL is asserted
 * safe BEFORE the request is issued (redirects are followed manually with
 * `redirect: 'manual'`), so a blocked host is never *contacted* — not merely
 * never returned. Also enforces a size cap, a single total timeout shared
 * across hops, and a redirect ceiling.
 */
export async function fetchTextOverHttps(
  url: string,
  deps: HttpsFetchDeps = {},
  accept = 'application/json',
): Promise<string> {
  const allowPrivate = deps.allowPrivate ?? false
  const fetchImpl = deps.fetchImpl ?? fetch
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ctrl = new AbortController()
  const timer = setTimeout(() => {
    ctrl.abort()
  }, timeoutMs)
  try {
    let currentUrl = url
    for (let hop = 0; ; hop++) {
      // Validate BEFORE connecting — closes pre-connection SSRF and any
      // redirect downgrade to a private/non-HTTPS host.
      assertPublicHttpsUrl(currentUrl, allowPrivate)
      const res = await fetchImpl(currentUrl, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { Accept: accept },
      })
      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) {
          throw new Error(`flyway: too many redirects (>${String(MAX_REDIRECTS)}) for ${url}`)
        }
        const location = res.headers.get('location')
        if (!location) {
          throw new Error(
            `flyway: redirect (HTTP ${String(res.status)}) with no Location from ${currentUrl}`,
          )
        }
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      if (!res.ok) {
        throw new Error(`flyway: fetch failed (HTTP ${String(res.status)}) for ${currentUrl}`)
      }
      return await readCapped(res, maxBytes)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`flyway: fetch timed out after ${String(timeoutMs)}ms for ${url}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

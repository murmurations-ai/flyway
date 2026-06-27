import { describe, expect, it, vi } from 'vitest'
import { assertPublicHttpsUrl, fetchTextOverHttps } from './http.js'

describe('assertPublicHttpsUrl — scheme + basic SSRF', () => {
  it('accepts a public https URL', () => {
    expect(() => assertPublicHttpsUrl('https://directory.flyway.dev/x')).not.toThrow()
    expect(() => assertPublicHttpsUrl('https://[2606:4700::1]/x')).not.toThrow() // public IPv6
  })

  it('refuses non-https and malformed', () => {
    expect(() => assertPublicHttpsUrl('http://example.com')).toThrow(/HTTPS-only/)
    expect(() => assertPublicHttpsUrl('ftp://example.com')).toThrow(/HTTPS-only/)
    expect(() => assertPublicHttpsUrl('not a url')).toThrow(/not a valid URL/)
  })

  it('refuses IPv4 loopback / private / link-local literals', () => {
    for (const h of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0']) {
      expect(() => assertPublicHttpsUrl(`https://${h}/x`), h).toThrow(/private\/loopback/)
    }
  })

  it('refuses IPv4 written in non-dotted encodings (URL normalizes them)', () => {
    // Node's URL normalizes these to dotted-decimal before our guard sees them.
    for (const h of ['0177.0.0.1', '0x7f000001', '2130706433', '127.1']) {
      expect(() => assertPublicHttpsUrl(`https://${h}/x`), h).toThrow(/private\/loopback/)
    }
  })

  it('refuses IPv6 loopback / link-local / ULA / site-local / multicast', () => {
    for (const h of ['[::1]', '[fe80::1]', '[fc00::1]', '[fd12:3456::1]', '[fec0::1]', '[ff02::1]']) {
      expect(() => assertPublicHttpsUrl(`https://${h}/x`), h).toThrow(/private\/loopback/)
    }
  })

  it('refuses IPv6 forms that EMBED a blocked IPv4 (H-1 bypasses)', () => {
    for (const h of [
      '[::ffff:127.0.0.1]', // IPv4-mapped loopback
      '[::ffff:169.254.169.254]', // IPv4-mapped cloud metadata
      '[64:ff9b::127.0.0.1]', // NAT64
      '[2002:7f00:1::]', // 6to4 of 127.0.0.1
    ]) {
      expect(() => assertPublicHttpsUrl(`https://${h}/x`), h).toThrow(/private\/loopback/)
    }
  })

  it('allows a private host when allowPrivate is set', () => {
    expect(() => assertPublicHttpsUrl('https://127.0.0.1/x', true)).not.toThrow()
    expect(() => assertPublicHttpsUrl('https://[::1]/x', true)).not.toThrow()
  })
})

describe('fetchTextOverHttps — body', () => {
  it('returns the body of a 200 response', async () => {
    const fetchImpl = (async () => new Response('hello', { status: 200 })) as unknown as typeof fetch
    expect(await fetchTextOverHttps('https://x.dev/a', { fetchImpl })).toBe('hello')
  })

  it('surfaces a non-2xx as an error', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(fetchTextOverHttps('https://x.dev/a', { fetchImpl })).rejects.toThrow(/HTTP 404/)
  })

  it('enforces the byte cap at the boundary', async () => {
    const under = (async () => new Response('x'.repeat(100), { status: 200 })) as unknown as typeof fetch
    expect(await fetchTextOverHttps('https://x.dev/a', { fetchImpl: under, maxBytes: 100 })).toHaveLength(100)
    const over = (async () => new Response('x'.repeat(101), { status: 200 })) as unknown as typeof fetch
    await expect(
      fetchTextOverHttps('https://x.dev/a', { fetchImpl: over, maxBytes: 100 }),
    ).rejects.toThrow(/exceeds 100-byte cap/)
  })

  it('times out a hanging fetch (AbortError → timed out)', async () => {
    const fetchImpl = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })) as unknown as typeof fetch
    await expect(
      fetchTextOverHttps('https://x.dev/slow', { fetchImpl, timeoutMs: 20 }),
    ).rejects.toThrow(/timed out after 20ms/)
  })
})

describe('fetchTextOverHttps — redirects (H-2)', () => {
  it('follows a redirect to a public host', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://a.dev/start') {
        return new Response(null, { status: 302, headers: { location: 'https://b.dev/end' } })
      }
      return new Response('arrived', { status: 200 })
    }) as unknown as typeof fetch
    expect(await fetchTextOverHttps('https://a.dev/start', { fetchImpl })).toBe('arrived')
  })

  it('refuses a redirect to a private host WITHOUT contacting it', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      if (url === 'https://a.dev/start') {
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/internal' } })
      }
      return new Response('should-not-reach', { status: 200 })
    }) as unknown as typeof fetch
    await expect(
      fetchTextOverHttps('https://a.dev/start', { fetchImpl }),
    ).rejects.toThrow(/private\/loopback/)
    // The private redirect target was validated BEFORE any request to it.
    expect(calls).toEqual(['https://a.dev/start'])
  })

  it('refuses a redirect that downgrades to http', async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 301, headers: { location: 'http://a.dev/insecure' } })) as unknown as typeof fetch
    await expect(fetchTextOverHttps('https://a.dev/start', { fetchImpl })).rejects.toThrow(/HTTPS-only/)
  })

  it('bounds the redirect chain', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n += 1
      return new Response(null, { status: 302, headers: { location: `https://a.dev/hop${String(n)}` } })
    }) as unknown as typeof fetch
    await expect(fetchTextOverHttps('https://a.dev/start', { fetchImpl })).rejects.toThrow(/too many redirects/)
  })
})

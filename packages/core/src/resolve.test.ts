import { describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import { didWebResolutionUrls, resolvePeerIdentity } from './resolve.js'

/** Map URL → response body, so a fetch stub can serve two artifacts. */
function routedFetch(routes: Record<string, string>): typeof fetch {
  // eslint-disable-next-line @typescript-eslint/require-await -- stub matches async fetch signature
  return (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = routes[url]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
}

describe('didWebResolutionUrls', () => {
  it('maps a github.com did:web to raw.githubusercontent URLs (default branch main)', () => {
    const urls = didWebResolutionUrls('did:web:github.com:xeeban:a')
    expect(urls.didDocUrl).toBe(
      'https://raw.githubusercontent.com/xeeban/a/main/.well-known/did.json',
    )
    expect(urls.entityStatementUrl).toBe(
      'https://raw.githubusercontent.com/xeeban/a/main/flyway/entity-statement.json',
    )
  })

  it('honours a custom branch', () => {
    const urls = didWebResolutionUrls('did:web:github.com:xeeban:a', 'release')
    expect(urls.didDocUrl).toContain('/xeeban/a/release/.well-known/did.json')
  })

  it('refuses a non-github host (not yet supported)', () => {
    expect(() => didWebResolutionUrls('did:web:example.com:a:b')).toThrow(/only implemented for/)
  })

  it('refuses a did:web without exactly owner:repo', () => {
    expect(() => didWebResolutionUrls('did:web:github.com:only-one')).toThrow(/path segments/)
  })

  it('refuses a non-did:web identifier', () => {
    expect(() => didWebResolutionUrls('did:key:zABC')).toThrow(/not a did:web/)
  })

  it('rejects a malformed percent-encoded segment with a flyway error (not a raw URIError)', () => {
    expect(() => didWebResolutionUrls('did:web:github.com:owner:%zz')).toThrow(
      /flyway resolve:.*invalid percent-encoded/,
    )
  })
})

describe('resolvePeerIdentity', () => {
  it('fetches and returns the peer DID document + entity statement', async () => {
    const peer = await flywayInit({
      repoUrl: 'https://github.com/xeeban/a',
      sourceName: 'Nori',
      mode: 'interactive',
    })
    const urls = didWebResolutionUrls(peer.did)
    const fetchImpl = routedFetch({
      [urls.didDocUrl]: JSON.stringify(peer.didDocument),
      [urls.entityStatementUrl]: JSON.stringify(peer.entityStatement),
    })
    const resolved = await resolvePeerIdentity(peer.did, { fetchImpl })
    expect(resolved.didDocument.id).toBe(peer.did)
    expect(resolved.entityStatement.did).toBe(peer.did)
    expect(resolved.didDocUrl).toBe(urls.didDocUrl)
  })

  it('rejects when the fetched DID document id does not match the requested did', async () => {
    const peer = await flywayInit({
      repoUrl: 'https://github.com/xeeban/a',
      sourceName: 'Nori',
      mode: 'interactive',
    })
    const other = await flywayInit({
      repoUrl: 'https://github.com/emergent/praxis',
      sourceName: 'Praxis',
      mode: 'interactive',
    })
    const urls = didWebResolutionUrls(peer.did)
    const fetchImpl = routedFetch({
      [urls.didDocUrl]: JSON.stringify(other.didDocument), // wrong id
      [urls.entityStatementUrl]: JSON.stringify(peer.entityStatement),
    })
    await expect(resolvePeerIdentity(peer.did, { fetchImpl })).rejects.toThrow(
      /DID document id .* does not match/,
    )
  })

  it('rejects invalid JSON', async () => {
    const urls = didWebResolutionUrls('did:web:github.com:xeeban:a')
    const fetchImpl = routedFetch({
      [urls.didDocUrl]: '{not json',
      [urls.entityStatementUrl]: '{}',
    })
    await expect(resolvePeerIdentity('did:web:github.com:xeeban:a', { fetchImpl })).rejects.toThrow(
      /not valid JSON/,
    )
  })

  it('propagates the HTTPS guard (404 → error)', async () => {
    const fetchImpl = routedFetch({}) // every URL 404s
    await expect(resolvePeerIdentity('did:web:github.com:xeeban:a', { fetchImpl })).rejects.toThrow(
      /HTTP 404/,
    )
  })

  it('fails if only the entity statement is missing (one-sided failure)', async () => {
    const peer = await flywayInit({
      repoUrl: 'https://github.com/xeeban/a',
      sourceName: 'Nori',
      mode: 'interactive',
    })
    const urls = didWebResolutionUrls(peer.did)
    const fetchImpl = routedFetch({
      [urls.didDocUrl]: JSON.stringify(peer.didDocument), // ok
      // entityStatementUrl absent → 404
    })
    await expect(resolvePeerIdentity(peer.did, { fetchImpl })).rejects.toThrow(/HTTP 404/)
  })
})

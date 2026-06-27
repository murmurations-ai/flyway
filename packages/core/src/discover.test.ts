import { describe, expect, it } from 'vitest'
import {
  type FlywayDirectory,
  FLYWAY_DIRECTORY_SCHEMA_VERSION,
  assertPublicHttpsUrl,
  flywayDiscover,
  loadDirectory,
  parseDirectoryLocation,
  parseFlywayDirectory,
} from './discover.js'

const DIRECTORY_YAML = `schemaVersion: "${FLYWAY_DIRECTORY_SCHEMA_VERSION}"
entries:
  - did: did:web:github.com:xeeban:a
    sourceName: Nori
    capabilities: [governance]
`

/** Build a fetch stub returning a Response with the given body/status. */
function stubFetch(body: string, init: ResponseInit = { status: 200 }): typeof fetch {
  return (async () => new Response(body, init)) as unknown as typeof fetch
}

function directory(): FlywayDirectory {
  return {
    schemaVersion: FLYWAY_DIRECTORY_SCHEMA_VERSION,
    updatedAt: '2026-06-17T12:00:00.000Z',
    entries: [
      {
        did: 'did:web:github.com:xeeban:a',
        sourceName: 'Nori',
        mode: 'interactive',
        capabilities: ['governance', 'facilitation'],
        description: 'Andamio-adjacent murmuration.',
      },
      {
        did: 'did:web:github.com:emergent:praxis',
        sourceName: 'Praxis',
        mode: 'persistent',
        capabilities: ['governance', 'research'],
      },
      {
        did: 'did:web:github.com:chinook:wind',
        sourceName: 'Chinook Wind',
        capabilities: ['real-estate'],
      },
    ],
  }
}

describe('flywayDiscover', () => {
  it('returns every entry when the query is absent', () => {
    const r = flywayDiscover({ directory: directory() })
    expect(r.query).toBeUndefined()
    expect(r.byDid).toBe(false)
    expect(r.total).toBe(3)
    expect(r.matches).toHaveLength(3)
  })

  it('returns every entry when the query is whitespace only', () => {
    const r = flywayDiscover({ directory: directory(), query: '   ' })
    expect(r.matches).toHaveLength(3)
    expect(r.query).toBeUndefined()
  })

  it('does an exact DID lookup when the query starts with did:', () => {
    const r = flywayDiscover({
      directory: directory(),
      query: 'did:web:github.com:emergent:praxis',
    })
    expect(r.byDid).toBe(true)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]?.sourceName).toBe('Praxis')
  })

  it('returns no matches for a DID not in the directory', () => {
    const r = flywayDiscover({ directory: directory(), query: 'did:web:github.com:nope:nope' })
    expect(r.byDid).toBe(true)
    expect(r.matches).toHaveLength(0)
  })

  it('free-text matches across sourceName, capabilities, and description', () => {
    const byCapability = flywayDiscover({ directory: directory(), query: 'governance' })
    expect(byCapability.matches.map((e) => e.sourceName)).toEqual(['Nori', 'Praxis'])

    const byName = flywayDiscover({ directory: directory(), query: 'chinook' })
    expect(byName.matches).toHaveLength(1)
    expect(byName.matches[0]?.did).toBe('did:web:github.com:chinook:wind')

    const byDescription = flywayDiscover({ directory: directory(), query: 'andamio' })
    expect(byDescription.matches).toHaveLength(1)
    expect(byDescription.matches[0]?.sourceName).toBe('Nori')
  })

  it('free-text matching is case-insensitive and preserves directory order', () => {
    const r = flywayDiscover({ directory: directory(), query: 'GOVERNANCE' })
    expect(r.matches.map((e) => e.sourceName)).toEqual(['Nori', 'Praxis'])
  })

  it('treats a bare did: prefix as a DID lookup (not free text)', () => {
    // "did:" with no full DID matches nothing under exact-DID semantics.
    const r = flywayDiscover({ directory: directory(), query: 'did:web' })
    expect(r.byDid).toBe(true)
    expect(r.matches).toHaveLength(0)
  })
})

describe('parseFlywayDirectory', () => {
  it('accepts a well-formed directory and defensively copies entries', () => {
    const parsed = parseFlywayDirectory({
      schemaVersion: '0.1.0',
      entries: [{ did: 'did:web:x:a', sourceName: 'A', capabilities: ['x'] }],
    })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]?.capabilities).toEqual(['x'])
  })

  it('rejects a non-object', () => {
    expect(() => parseFlywayDirectory(null)).toThrow(/must be an object/)
    expect(() => parseFlywayDirectory('nope')).toThrow(/must be an object/)
  })

  it('requires a schemaVersion', () => {
    expect(() => parseFlywayDirectory({ entries: [] })).toThrow(/schemaVersion/)
  })

  it('requires entries to be an array', () => {
    expect(() => parseFlywayDirectory({ schemaVersion: '0.1.0', entries: {} })).toThrow(
      /entries must be an array/,
    )
  })

  it('requires did and sourceName on each entry', () => {
    expect(() =>
      parseFlywayDirectory({ schemaVersion: '0.1.0', entries: [{ sourceName: 'A' }] }),
    ).toThrow(/entries\[0\]\.did/)
    expect(() =>
      parseFlywayDirectory({ schemaVersion: '0.1.0', entries: [{ did: 'did:web:x:a' }] }),
    ).toThrow(/entries\[0\]\.sourceName/)
  })

  it('rejects duplicate DIDs', () => {
    expect(() =>
      parseFlywayDirectory({
        schemaVersion: '0.1.0',
        entries: [
          { did: 'did:web:x:a', sourceName: 'A' },
          { did: 'did:web:x:a', sourceName: 'A-again' },
        ],
      }),
    ).toThrow(/duplicate did/)
  })

  it('rejects an invalid mode', () => {
    expect(() =>
      parseFlywayDirectory({
        schemaVersion: '0.1.0',
        entries: [{ did: 'did:web:x:a', sourceName: 'A', mode: 'galaxy' }],
      }),
    ).toThrow(/mode must be one of/)
  })

  it('rejects non-string capabilities', () => {
    expect(() =>
      parseFlywayDirectory({
        schemaVersion: '0.1.0',
        entries: [{ did: 'did:web:x:a', sourceName: 'A', capabilities: ['ok', 3] }],
      }),
    ).toThrow(/capabilities must be an array of strings/)
  })

  it('round-trips through flywayDiscover', () => {
    const parsed = parseFlywayDirectory({
      schemaVersion: '0.1.0',
      entries: [
        { did: 'did:web:x:a', sourceName: 'Alpha', capabilities: ['search'] },
        { did: 'did:web:x:b', sourceName: 'Beta' },
      ],
    })
    expect(flywayDiscover({ directory: parsed, query: 'search' }).matches).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────────
// parseDirectoryLocation (v0.2a)
// ────────────────────────────────────────────────────────────────────────

describe('parseDirectoryLocation', () => {
  it('classifies https URLs as a remote fetch', () => {
    expect(parseDirectoryLocation('https://example.com/dir.yaml')).toEqual({
      kind: 'https',
      url: 'https://example.com/dir.yaml',
    })
  })

  it('refuses http:// (HTTPS only)', () => {
    expect(() => parseDirectoryLocation('http://example.com/dir.yaml')).toThrow(/HTTPS-only/)
  })

  it('treats everything else as a local file path', () => {
    expect(parseDirectoryLocation('/tmp/dir.yaml')).toEqual({ kind: 'file', path: '/tmp/dir.yaml' })
    expect(parseDirectoryLocation('./dir.json')).toEqual({ kind: 'file', path: './dir.json' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// assertPublicHttpsUrl (SSRF guard)
// ────────────────────────────────────────────────────────────────────────

describe('assertPublicHttpsUrl', () => {
  it('accepts a public https URL', () => {
    expect(() => assertPublicHttpsUrl('https://directory.flyway.dev/list.yaml')).not.toThrow()
  })

  it('refuses non-https', () => {
    expect(() => assertPublicHttpsUrl('http://example.com')).toThrow(/HTTPS-only/)
  })

  it('refuses loopback and private hosts', () => {
    expect(() => assertPublicHttpsUrl('https://localhost/d')).toThrow(/private\/loopback/)
    expect(() => assertPublicHttpsUrl('https://127.0.0.1/d')).toThrow(/private\/loopback/)
    expect(() => assertPublicHttpsUrl('https://10.0.0.5/d')).toThrow(/private\/loopback/)
    expect(() => assertPublicHttpsUrl('https://192.168.1.1/d')).toThrow(/private\/loopback/)
    expect(() => assertPublicHttpsUrl('https://172.16.0.1/d')).toThrow(/private\/loopback/)
    expect(() => assertPublicHttpsUrl('https://169.254.0.1/d')).toThrow(/private\/loopback/)
    expect(() => assertPublicHttpsUrl('https://[::1]/d')).toThrow(/private\/loopback/)
  })

  it('allows a private host when allowPrivate is set', () => {
    expect(() => assertPublicHttpsUrl('https://127.0.0.1/d', true)).not.toThrow()
  })

  it('rejects a malformed URL', () => {
    expect(() => assertPublicHttpsUrl('not a url')).toThrow(/not a valid URL/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// loadDirectory (v0.2a)
// ────────────────────────────────────────────────────────────────────────

describe('loadDirectory', () => {
  it('loads a local file via injected reader', async () => {
    const d = await loadDirectory(
      { kind: 'file', path: '/dir.yaml' },
      { readFileImpl: () => DIRECTORY_YAML },
    )
    expect(d.entries).toHaveLength(1)
    expect(d.entries[0]?.sourceName).toBe('Nori')
  })

  it('reports a missing local file clearly', async () => {
    const enoent = () => {
      const e = new Error('no such file') as NodeJS.ErrnoException
      e.code = 'ENOENT'
      throw e
    }
    await expect(
      loadDirectory({ kind: 'file', path: '/nope.yaml' }, { readFileImpl: enoent }),
    ).rejects.toThrow(/file not found/)
  })

  it('fetches an https directory via injected fetch', async () => {
    const d = await loadDirectory(
      { kind: 'https', url: 'https://directory.flyway.dev/list.yaml' },
      { fetchImpl: stubFetch(DIRECTORY_YAML) },
    )
    expect(d.entries[0]?.did).toBe('did:web:github.com:xeeban:a')
  })

  it('refuses a private https host before fetching', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return new Response(DIRECTORY_YAML)
    }) as unknown as typeof fetch
    await expect(
      loadDirectory({ kind: 'https', url: 'https://127.0.0.1/list.yaml' }, { fetchImpl: spy }),
    ).rejects.toThrow(/private\/loopback/)
    expect(called).toBe(false)
  })

  it('surfaces a non-2xx fetch as an error', async () => {
    await expect(
      loadDirectory(
        { kind: 'https', url: 'https://directory.flyway.dev/missing.yaml' },
        { fetchImpl: stubFetch('not found', { status: 404 }) },
      ),
    ).rejects.toThrow(/HTTP 404/)
  })

  it('enforces the byte cap on the response body', async () => {
    const big = `schemaVersion: "${FLYWAY_DIRECTORY_SCHEMA_VERSION}"\nentries: []\n# ${'x'.repeat(2000)}`
    await expect(
      loadDirectory(
        { kind: 'https', url: 'https://directory.flyway.dev/big.yaml' },
        { fetchImpl: stubFetch(big), maxBytes: 100 },
      ),
    ).rejects.toThrow(/exceeds 100-byte cap/)
  })

  it('validates the fetched document through parseFlywayDirectory', async () => {
    await expect(
      loadDirectory(
        { kind: 'https', url: 'https://directory.flyway.dev/bad.yaml' },
        { fetchImpl: stubFetch('entries: []\n') }, // missing schemaVersion
      ),
    ).rejects.toThrow(/schemaVersion/)
  })
})

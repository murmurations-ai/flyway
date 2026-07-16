import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDiscover } from './discover.js'

const DIRECTORY_YAML = `schemaVersion: "0.1.0"
updatedAt: "2026-06-17T12:00:00.000Z"
entries:
  - did: did:web:github.com:xeeban:a
    sourceName: Nori
    mode: interactive
    capabilities: [governance, facilitation]
    repoUrl: https://github.com/xeeban/a
    description: Andamio-adjacent murmuration.
  - did: did:web:github.com:emergent:praxis
    sourceName: Praxis
    mode: persistent
    capabilities: [governance, research]
  - did: did:web:github.com:chinook:wind
    sourceName: Chinook Wind
    capabilities: [real-estate]
`

describe('runDiscover', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flyway-discover-test-'))
    path = join(dir, 'directory.yaml')
    writeFileSync(path, DIRECTORY_YAML)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists every entry with no query', async () => {
    const r = await runDiscover({ directory: path })
    expect(r.total).toBe(3)
    expect(r.matches).toHaveLength(3)
    expect(r.source.entries).toHaveLength(3)
  })

  it('free-text matches on capability', async () => {
    const r = await runDiscover({ directory: path, query: 'governance' })
    expect(r.matches.map((e) => e.sourceName)).toEqual(['Nori', 'Praxis'])
  })

  it('exact-DID lookup', async () => {
    const r = await runDiscover({ directory: path, query: 'did:web:github.com:chinook:wind' })
    expect(r.byDid).toBe(true)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]?.sourceName).toBe('Chinook Wind')
  })

  it('parses a JSON directory too (YAML is a JSON superset)', async () => {
    const jsonPath = join(dir, 'directory.json')
    writeFileSync(
      jsonPath,
      JSON.stringify({
        schemaVersion: '0.1.0',
        entries: [{ did: 'did:web:x:a', sourceName: 'Alpha' }],
      }),
    )
    const r = await runDiscover({ directory: jsonPath })
    expect(r.total).toBe(1)
    expect(r.matches[0]?.sourceName).toBe('Alpha')
  })

  it('fetches an https directory via an injected fetch (v0.2a)', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(DIRECTORY_YAML))) as unknown as typeof fetch
    const r = await runDiscover({
      directory: 'https://directory.flyway.dev/list.yaml',
      query: 'governance',
      fetchImpl,
    })
    expect(r.matches.map((e) => e.sourceName)).toEqual(['Nori', 'Praxis'])
  })

  it('refuses an http:// directory URL (HTTPS only)', async () => {
    await expect(
      runDiscover({ directory: 'http://example.com/flyway-directory.yaml' }),
    ).rejects.toThrow(/HTTPS-only/)
  })

  it('refuses a private-host https directory unless explicitly allowed', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(DIRECTORY_YAML))) as unknown as typeof fetch
    await expect(
      runDiscover({ directory: 'https://127.0.0.1/dir.yaml', fetchImpl }),
    ).rejects.toThrow(/private\/loopback/)
  })

  it('errors clearly when the directory file is missing', async () => {
    await expect(runDiscover({ directory: join(dir, 'nope.yaml') })).rejects.toThrow(/not found/)
  })

  it('surfaces a parse/validation error for a malformed directory', async () => {
    const badPath = join(dir, 'bad.yaml')
    writeFileSync(badPath, 'schemaVersion: "0.1.0"\nentries:\n  - sourceName: NoDid\n')
    await expect(runDiscover({ directory: badPath })).rejects.toThrow(/did must be a non-empty/)
  })
})

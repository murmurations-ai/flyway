import { describe, expect, it } from 'vitest'
import {
  buildDidDocument,
  buildEntityStatement,
  deriveDid,
  flywayInit,
  generateEd25519Keypair,
  parseRepoUrl,
} from './init.js'

describe('parseRepoUrl', () => {
  it('parses a plain https GitHub URL', () => {
    const parsed = parseRepoUrl('https://github.com/xeeban/flyway')
    expect(parsed).toEqual({ host: 'github.com', owner: 'xeeban', repo: 'flyway' })
  })

  it('accepts a trailing .git suffix', () => {
    const parsed = parseRepoUrl('https://github.com/xeeban/flyway.git')
    expect(parsed.repo).toBe('flyway')
  })

  it('accepts a trailing slash', () => {
    const parsed = parseRepoUrl('https://github.com/xeeban/flyway/')
    expect(parsed.repo).toBe('flyway')
  })

  it('rejects non-GitHub hosts', () => {
    expect(() => parseRepoUrl('https://gitlab.com/x/y')).toThrow(/GitHub URL/)
  })

  it('rejects URLs without a repo', () => {
    expect(() => parseRepoUrl('https://github.com/xeeban')).toThrow(/GitHub URL/)
  })

  it('rejects SSH URLs', () => {
    expect(() => parseRepoUrl('git@github.com:xeeban/flyway.git')).toThrow(/GitHub URL/)
  })
})

describe('deriveDid', () => {
  it('produces a did:web in the form host:owner:repo', () => {
    const did = deriveDid({ host: 'github.com', owner: 'xeeban', repo: 'flyway' })
    expect(did).toBe('did:web:github.com:xeeban:flyway')
  })
})

describe('generateEd25519Keypair', () => {
  it('produces a JWK with OKP / Ed25519 / x', () => {
    const kp = generateEd25519Keypair()
    expect(kp.publicKeyJwk.kty).toBe('OKP')
    expect(kp.publicKeyJwk.crv).toBe('Ed25519')
    expect(typeof kp.publicKeyJwk.x).toBe('string')
    expect(kp.publicKeyJwk.x.length).toBeGreaterThan(40) // base64url of 32 bytes ≈ 43 chars
  })

  it('produces a PKCS#8 PEM private key', () => {
    const kp = generateEd25519Keypair()
    expect(kp.privateKeyPem).toContain('BEGIN PRIVATE KEY')
    expect(kp.privateKeyPem).toContain('END PRIVATE KEY')
  })

  it('produces different keypairs on each call', () => {
    const a = generateEd25519Keypair()
    const b = generateEd25519Keypair()
    expect(a.publicKeyJwk.x).not.toBe(b.publicKeyJwk.x)
  })
})

describe('buildDidDocument', () => {
  it('includes both DID core and JWS-2020 contexts', () => {
    const kp = generateEd25519Keypair()
    const doc = buildDidDocument('did:web:github.com:owner:repo', kp)
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1')
    expect(doc['@context']).toContain('https://w3id.org/security/suites/jws-2020/v1')
  })

  it('declares the verification method as JsonWebKey2020', () => {
    const kp = generateEd25519Keypair()
    const doc = buildDidDocument('did:web:github.com:owner:repo', kp)
    expect(doc.verificationMethod[0]?.type).toBe('JsonWebKey2020')
  })

  it('references the verification method from authentication', () => {
    const kp = generateEd25519Keypair()
    const doc = buildDidDocument('did:web:github.com:owner:repo', kp)
    expect(doc.authentication[0]).toBe(doc.verificationMethod[0]?.id)
    expect(doc.authentication[0]).toBe('did:web:github.com:owner:repo#key-1')
  })

  it('sets controller to the DID', () => {
    const kp = generateEd25519Keypair()
    const did = 'did:web:github.com:owner:repo'
    const doc = buildDidDocument(did, kp)
    expect(doc.verificationMethod[0]?.controller).toBe(did)
  })
})

describe('buildEntityStatement', () => {
  it('carries Source metadata and a stable verification key reference', () => {
    const did = 'did:web:github.com:owner:repo'
    const fixedDate = new Date('2026-05-19T07:30:00Z')
    const stmt = buildEntityStatement(
      did,
      { repoUrl: 'https://github.com/owner/repo', sourceName: 'Nori', mode: 'interactive' },
      fixedDate,
    )
    expect(stmt.did).toBe(did)
    expect(stmt.sourceName).toBe('Nori')
    expect(stmt.mode).toBe('interactive')
    expect(stmt.createdAt).toBe('2026-05-19T07:30:00.000Z')
    expect(stmt.verificationKeyId).toBe(`${did}#key-1`)
  })

  it('lists every flyway tool as supported', () => {
    const stmt = buildEntityStatement(
      'did:web:github.com:owner:repo',
      { repoUrl: 'https://github.com/owner/repo', sourceName: 'Nori', mode: 'interactive' },
    )
    expect(stmt.toolsSupported).toContain('flyway_init')
    expect(stmt.toolsSupported).toContain('flyway_tension')
    expect(stmt.toolsSupported).toContain('flyway_exit')
  })

  it('declares the agreement schema version supported', () => {
    const stmt = buildEntityStatement(
      'did:web:github.com:owner:repo',
      { repoUrl: 'https://github.com/owner/repo', sourceName: 'Nori', mode: 'interactive' },
    )
    expect(stmt.schemasSupported[0]).toMatch(/^agreement@\d+\.\d+\.\d+$/)
  })
})

describe('flywayInit (end-to-end)', () => {
  it('returns coherent artifacts for a valid input', () => {
    const artifacts = flywayInit({
      repoUrl: 'https://github.com/xeeban/flyway',
      sourceName: 'Nori',
      mode: 'interactive',
    })
    expect(artifacts.did).toBe('did:web:github.com:xeeban:flyway')
    expect(artifacts.didDocument.id).toBe(artifacts.did)
    expect(artifacts.entityStatement.did).toBe(artifacts.did)
    expect(artifacts.didDocument.verificationMethod[0]?.publicKeyJwk.x).toBe(
      artifacts.keypair.publicKeyJwk.x,
    )
    expect(artifacts.entityStatement.verificationKeyId).toBe(
      artifacts.didDocument.verificationMethod[0]?.id,
    )
  })

  it('throws on invalid repoUrl', () => {
    expect(() =>
      flywayInit({
        repoUrl: 'not a url',
        sourceName: 'Nori',
        mode: 'interactive',
      }),
    ).toThrow(/GitHub URL/)
  })
})

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import { flywayStatus } from './status.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-status-test-'))
}

async function seedIdentity(cwd: string): Promise<{ did: string }> {
  const artifacts = await flywayInit({
    repoUrl: 'https://github.com/xeeban/flyway',
    sourceName: 'Nori',
    mode: 'interactive',
  })
  mkdirSync(join(cwd, '.well-known'), { recursive: true })
  mkdirSync(join(cwd, 'flyway', 'keys'), { recursive: true })
  writeFileSync(
    join(cwd, '.well-known', 'did.json'),
    JSON.stringify(artifacts.didDocument, null, 2),
  )
  writeFileSync(
    join(cwd, 'flyway', 'entity-statement.json'),
    JSON.stringify(artifacts.entityStatement, null, 2),
  )
  writeFileSync(join(cwd, 'flyway', 'keys', 'source.key'), artifacts.keypair.privateKeyPem)
  return { did: artifacts.did }
}

describe('flywayStatus — empty directory', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports identity as uninitialized when no flyway files exist', async () => {
    const status = await flywayStatus(tmp)
    expect(status.identity.initialized).toBe(false)
    expect(status.identity.issues[0]).toMatch(/no flyway identity/)
  })

  it('reports peers as absent', async () => {
    const status = await flywayStatus(tmp)
    expect(status.peers.present).toBe(false)
  })

  it('reports zero agreements', async () => {
    const status = await flywayStatus(tmp)
    expect(status.agreements.count).toBe(0)
    expect(status.agreements.ids).toEqual([])
  })
})

describe('flywayStatus — healthy initialized identity', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports the DID, source name, and mode from the entity statement', async () => {
    const { did } = await seedIdentity(tmp)
    const status = await flywayStatus(tmp)
    expect(status.identity.initialized).toBe(true)
    expect(status.identity.did).toBe(did)
    expect(status.identity.sourceName).toBe('Nori')
    expect(status.identity.mode).toBe('interactive')
  })

  it('verifies the entity statement signature against the DID document', async () => {
    await seedIdentity(tmp)
    const status = await flywayStatus(tmp)
    expect(status.identity.signatureValid).toBe(true)
    expect(status.identity.issues).toEqual([])
  })
})

describe('flywayStatus — degraded states', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('flags a tampered entity statement as signature-invalid', async () => {
    await seedIdentity(tmp)
    const stmtPath = join(tmp, 'flyway', 'entity-statement.json')
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8'))
    stmt.sourceName = 'Imposter'
    writeFileSync(stmtPath, JSON.stringify(stmt, null, 2))
    const status = await flywayStatus(tmp)
    expect(status.identity.signatureValid).toBe(false)
    expect(status.identity.issues.some((i) => /does NOT verify/.test(i))).toBe(true)
  })

  it('flags a missing DID document when only the entity statement is present', async () => {
    await seedIdentity(tmp)
    rmSync(join(tmp, '.well-known', 'did.json'))
    const status = await flywayStatus(tmp)
    expect(status.identity.issues.some((i) => /\.well-known\/did\.json/.test(i))).toBe(true)
  })

  it('flags an unsigned (legacy) entity statement', async () => {
    await seedIdentity(tmp)
    const stmtPath = join(tmp, 'flyway', 'entity-statement.json')
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8'))
    delete stmt.signature
    writeFileSync(stmtPath, JSON.stringify(stmt, null, 2))
    const status = await flywayStatus(tmp)
    expect(status.identity.signatureValid).toBe(false)
    expect(status.identity.issues.some((i) => /unsigned/.test(i))).toBe(true)
  })
})

describe('flywayStatus — peers and agreements', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports peers.yaml when it exists', async () => {
    mkdirSync(join(tmp, 'flyway'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'peers.yaml'), 'peers: []\n')
    const status = await flywayStatus(tmp)
    expect(status.peers.present).toBe(true)
  })

  it('flags drift when the cached peer entity statement has been replaced (G3)', async () => {
    // Hand-craft a peers.yaml entry pointing at a cache where the cached
    // statement's fingerprint no longer matches the recognition entry.
    await seedIdentity(tmp)
    const A = await flywayInit({
      repoUrl: 'https://github.com/xeeban/a-other',
      sourceName: 'A Other',
      mode: 'interactive',
    })
    const peerArtifacts = await flywayInit({
      repoUrl: 'https://github.com/xeeban/peer',
      sourceName: 'Peer',
      mode: 'interactive',
    })
    // Place a fake recognition entry into peers.yaml pointing at the peer cache.
    const peersYaml = [
      'schema: flyway-peers-v0',
      'peers:',
      `  - did: ${peerArtifacts.did}`,
      '    sourceName: Peer',
      '    mode: interactive',
      `    peerVerificationKeyId: ${peerArtifacts.did}#key-1`,
      '    peerPublicKey:',
      '      kty: OKP',
      '      crv: Ed25519',
      `      x: ${peerArtifacts.didDocument.verificationMethod[0]!.publicKeyJwk.x}`,
      '    entityStatementFingerprint: ZZZ_DRIFTED_FINGERPRINT_AAAA',
      '    recognizedAt: 2026-01-01T00:00:00.000Z',
      `    recognizedBy: ${A.did}`,
      '    signature:',
      `      verificationKeyId: ${A.did}#key-1`,
      '      algorithm: EdDSA',
      '      canonicalization: flyway-jcs-v1',
      '      domain: flyway-v1:recognition',
      '      signature: fake-signature-bytes',
      '',
    ].join('\n')
    writeFileSync(join(tmp, 'flyway', 'peers.yaml'), peersYaml)
    // Drop the cached peer artifacts into place.
    const peerCache = join(tmp, 'flyway', 'peers', 'github.com', 'xeeban', 'peer')
    mkdirSync(peerCache, { recursive: true })
    writeFileSync(
      join(peerCache, 'did.json'),
      JSON.stringify(peerArtifacts.didDocument, null, 2),
    )
    writeFileSync(
      join(peerCache, 'entity-statement.json'),
      JSON.stringify(peerArtifacts.entityStatement, null, 2),
    )

    const status = await flywayStatus(tmp)
    const peer = status.peers.entries.find((p) => p.did === peerArtifacts.did)
    expect(peer).toBeDefined()
    expect(peer!.cacheConsistent).toBe(false)
    expect(peer!.issues.some((i) => /fingerprint/.test(i))).toBe(true)
  })

  it('flags drift when the cached peer key has rotated (G3)', async () => {
    await seedIdentity(tmp)
    const A = await flywayInit({
      repoUrl: 'https://github.com/xeeban/a-other',
      sourceName: 'A Other',
      mode: 'interactive',
    })
    const peerOriginal = await flywayInit({
      repoUrl: 'https://github.com/xeeban/peer',
      sourceName: 'Peer',
      mode: 'interactive',
    })
    const peerRotated = await flywayInit({
      repoUrl: 'https://github.com/xeeban/peer',
      sourceName: 'Peer',
      mode: 'interactive',
    })
    // Recognition entry binds the ORIGINAL key + fingerprint, but the
    // cached DID document on disk has the ROTATED key.
    const peersYaml = [
      'schema: flyway-peers-v0',
      'peers:',
      `  - did: ${peerOriginal.did}`,
      '    sourceName: Peer',
      '    mode: interactive',
      `    peerVerificationKeyId: ${peerOriginal.did}#key-1`,
      '    peerPublicKey:',
      '      kty: OKP',
      '      crv: Ed25519',
      `      x: ${peerOriginal.didDocument.verificationMethod[0]!.publicKeyJwk.x}`,
      `    entityStatementFingerprint: ${(await import('./recognize.js')).fingerprintEntityStatement(peerRotated.entityStatement)}`,
      '    recognizedAt: 2026-01-01T00:00:00.000Z',
      `    recognizedBy: ${A.did}`,
      '    signature:',
      `      verificationKeyId: ${A.did}#key-1`,
      '      algorithm: EdDSA',
      '      canonicalization: flyway-jcs-v1',
      '      domain: flyway-v1:recognition',
      '      signature: fake',
      '',
    ].join('\n')
    writeFileSync(join(tmp, 'flyway', 'peers.yaml'), peersYaml)
    const peerCache = join(tmp, 'flyway', 'peers', 'github.com', 'xeeban', 'peer')
    mkdirSync(peerCache, { recursive: true })
    writeFileSync(
      join(peerCache, 'did.json'),
      JSON.stringify(peerRotated.didDocument, null, 2),
    )
    writeFileSync(
      join(peerCache, 'entity-statement.json'),
      JSON.stringify(peerRotated.entityStatement, null, 2),
    )

    const status = await flywayStatus(tmp)
    const peer = status.peers.entries.find((p) => p.did === peerOriginal.did)
    expect(peer).toBeDefined()
    expect(peer!.cacheConsistent).toBe(false)
    expect(peer!.issues.some((i) => /rotated keys/.test(i))).toBe(true)
  })

  it('counts yaml files in flyway/agreements and lists their ids', async () => {
    mkdirSync(join(tmp, 'flyway', 'agreements'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'agreements', 'andamio-2026Q2.yaml'), 'kind: agreement\n')
    writeFileSync(join(tmp, 'flyway', 'agreements', 'odin-recognition.yaml'), 'kind: agreement\n')
    writeFileSync(join(tmp, 'flyway', 'agreements', 'README.md'), '# not an agreement')
    const status = await flywayStatus(tmp)
    expect(status.agreements.count).toBe(2)
    expect(status.agreements.ids).toEqual(['andamio-2026Q2', 'odin-recognition'])
  })

  it('ignores dotfiles in the agreements directory', async () => {
    mkdirSync(join(tmp, 'flyway', 'agreements'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'agreements', '.gitkeep'), '')
    writeFileSync(join(tmp, 'flyway', 'agreements', 'real.yaml'), 'kind: agreement\n')
    const status = await flywayStatus(tmp)
    expect(status.agreements.count).toBe(1)
    expect(status.agreements.ids).toEqual(['real'])
  })
})

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExit } from './exit.js'
import { flywayInit } from './init.js'
import { fingerprintEntityStatement } from './recognize.js'
import {
  type SignedSignalEnvelope,
  buildSignedSignal,
  signalInboxPath,
  writeSignalToInbox,
  writeSignalToOutbox,
} from './signal.js'
import { type Signer, localEd25519Signer } from './signing.js'
import { flywayStatus } from './status.js'

/** Assert a fixture value is present without a non-null assertion. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('must: expected a defined value')
  return value
}

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
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8')) as Record<string, unknown>
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
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8')) as Record<string, unknown>
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
      `      x: ${must(peerArtifacts.didDocument.verificationMethod[0]).publicKeyJwk.x}`,
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
    writeFileSync(join(peerCache, 'did.json'), JSON.stringify(peerArtifacts.didDocument, null, 2))
    writeFileSync(
      join(peerCache, 'entity-statement.json'),
      JSON.stringify(peerArtifacts.entityStatement, null, 2),
    )

    const status = await flywayStatus(tmp)
    const peer = status.peers.entries.find((p) => p.did === peerArtifacts.did)
    expect(peer).toBeDefined()
    expect(must(peer).cacheConsistent).toBe(false)
    expect(must(peer).issues.some((i) => /fingerprint/.test(i))).toBe(true)
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
      `      x: ${must(peerOriginal.didDocument.verificationMethod[0]).publicKeyJwk.x}`,
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
    writeFileSync(join(peerCache, 'did.json'), JSON.stringify(peerRotated.didDocument, null, 2))
    writeFileSync(
      join(peerCache, 'entity-statement.json'),
      JSON.stringify(peerRotated.entityStatement, null, 2),
    )

    const status = await flywayStatus(tmp)
    const peer = status.peers.entries.find((p) => p.did === peerOriginal.did)
    expect(peer).toBeDefined()
    expect(must(peer).cacheConsistent).toBe(false)
    expect(must(peer).issues.some((i) => /rotated keys/.test(i))).toBe(true)
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

// ────────────────────────────────────────────────────────────────────────
// Exit-aware effective status (ADR-0013)
// ────────────────────────────────────────────────────────────────────────

interface Murmuration {
  readonly artifacts: Awaited<ReturnType<typeof flywayInit>>
  readonly signer: Signer
}

async function makeMurmuration(owner: string, name: string): Promise<Murmuration> {
  const artifacts = await flywayInit({
    repoUrl: `https://github.com/${owner}/${name}`,
    sourceName: owner,
    mode: 'interactive',
  })
  const signer = localEd25519Signer({
    privateKeyPem: artifacts.keypair.privateKeyPem,
    publicKeyJwk: artifacts.keypair.publicKeyJwk,
    verificationKeyId: `${artifacts.did}#key-1`,
  })
  return { artifacts, signer }
}

/**
 * Seed `cwd` with our identity, a peers.yaml entry for `peer`, and the
 * cached peer DID document — the shape `flyway init` + `flyway recognize`
 * would leave. recognizedAt is early so later exits are never retroactive.
 */
function seedOursWithRecognizedPeer(cwd: string, ours: Murmuration, peer: Murmuration): void {
  mkdirSync(join(cwd, '.well-known'), { recursive: true })
  mkdirSync(join(cwd, 'flyway', 'keys'), { recursive: true })
  writeFileSync(
    join(cwd, '.well-known', 'did.json'),
    JSON.stringify(ours.artifacts.didDocument, null, 2),
  )
  writeFileSync(
    join(cwd, 'flyway', 'entity-statement.json'),
    JSON.stringify(ours.artifacts.entityStatement, null, 2),
  )

  const peerSegs = peer.artifacts.did.replace(/^did:web:/, '').split(':')
  const peerCache = join(cwd, 'flyway', 'peers', ...peerSegs)
  mkdirSync(peerCache, { recursive: true })
  writeFileSync(join(peerCache, 'did.json'), JSON.stringify(peer.artifacts.didDocument, null, 2))
  writeFileSync(
    join(peerCache, 'entity-statement.json'),
    JSON.stringify(peer.artifacts.entityStatement, null, 2),
  )

  const fp = fingerprintEntityStatement(peer.artifacts.entityStatement)
  const peerKey = must(peer.artifacts.didDocument.verificationMethod[0]).publicKeyJwk.x
  const peersYaml = [
    'schema: flyway-peers-v0',
    'peers:',
    `  - did: ${peer.artifacts.did}`,
    '    sourceName: peer',
    '    mode: interactive',
    `    peerVerificationKeyId: ${peer.artifacts.did}#key-1`,
    '    peerPublicKey:',
    '      kty: OKP',
    '      crv: Ed25519',
    `      x: ${peerKey}`,
    `    entityStatementFingerprint: ${fp}`,
    '    recognizedAt: 2026-05-21T00:00:00.000Z',
    `    recognizedBy: ${ours.artifacts.did}`,
    '    signature:',
    `      verificationKeyId: ${ours.artifacts.did}#key-1`,
    '      algorithm: EdDSA',
    '      canonicalization: flyway-jcs-v1',
    '      domain: flyway-v1:recognition',
    '      signature: fake',
    '',
  ].join('\n')
  writeFileSync(join(cwd, 'flyway', 'peers.yaml'), peersYaml)
}

function writeAgreement(
  cwd: string,
  id: string,
  fields: {
    participants: string[]
    state: string
    projectId?: string
    syndicateId?: string
    createdAt?: string
  },
): void {
  mkdirSync(join(cwd, 'flyway', 'agreements'), { recursive: true })
  writeFileSync(
    join(cwd, 'flyway', 'agreements', `${id}.yaml`),
    yamlStringify({ id, schemaVersion: '0.1.0', ...fields }),
  )
}

/** Place a signal envelope at an arbitrary inbox path (for replay tests). */
function placeInboxFileAt(
  cwd: string,
  fromDid: string,
  id: string,
  env: SignedSignalEnvelope,
): void {
  const p = signalInboxPath(cwd, fromDid, id)
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true })
  writeFileSync(p, yamlStringify(env))
}

describe('flywayStatus — exit-aware peer relationships (ADR-0013)', () => {
  let tmp: string
  let ours: Murmuration
  let peer: Murmuration
  beforeEach(async () => {
    tmp = freshTmp()
    ours = await makeMurmuration('xeeban', 'us')
    peer = await makeMurmuration('emergent', 'them')
    seedOursWithRecognizedPeer(tmp, ours, peer)
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('has no closure and no exits on a live relationship', async () => {
    const status = await flywayStatus(tmp)
    const p = status.peers.entries.find((e) => e.did === peer.artifacts.did)
    expect(p?.closure).toBeUndefined()
    expect(status.exits.count).toBe(0)
    expect(status.exits.issues).toEqual([])
  })

  it('marks the relationship we-exited when we sent a peer exit (outbox)', async () => {
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: peer.artifacts.did, targetType: 'peer', reason: 'season over' },
      signer: ours.signer,
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const p = status.peers.entries.find((e) => e.did === peer.artifacts.did)
    expect(p?.closure?.direction).toBe('we-exited')
    expect(p?.closure?.via).toBe('peer')
    expect(p?.closure?.reason).toBe('season over')
    // Exit does not retract recognition — the peer is still recognized.
    expect(p?.recognitionValid !== undefined).toBe(true)
    expect(status.exits.count).toBe(1)
  })

  it('marks the relationship peer-exited when the peer sent a verified peer exit (inbox)', async () => {
    const env = await createExit({
      from: peer.artifacts.did,
      to: ours.artifacts.did,
      body: { target: ours.artifacts.did, targetType: 'peer' },
      signer: peer.signer,
    })
    writeSignalToInbox(tmp, env)

    const status = await flywayStatus(tmp)
    const p = status.peers.entries.find((e) => e.did === peer.artifacts.did)
    expect(p?.closure?.direction).toBe('peer-exited')
    expect(status.exits.count).toBe(1)
    expect(status.exits.issues).toEqual([])
  })

  it('does NOT honor an inbox exit from an unrecognized sender', async () => {
    const stranger = await makeMurmuration('stranger', 'x')
    const env = await createExit({
      from: stranger.artifacts.did,
      to: ours.artifacts.did,
      body: { target: ours.artifacts.did, targetType: 'peer' },
      signer: stranger.signer,
    })
    // Place it in the inbox subtree by hand (no recognition entry exists).
    const path = signalInboxPath(tmp, stranger.artifacts.did, env.id)
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    writeFileSync(path, yamlStringify(env))

    const status = await flywayStatus(tmp)
    expect(status.exits.count).toBe(0)
    expect(status.exits.issues.some((i) => /unrecognized/.test(i))).toBe(true)
    const p = status.peers.entries.find((e) => e.did === peer.artifacts.did)
    expect(p?.closure).toBeUndefined()
  })

  it('does NOT honor an inbox exit whose signature has been tampered', async () => {
    const env = await createExit({
      from: peer.artifacts.did,
      to: ours.artifacts.did,
      body: { target: ours.artifacts.did, targetType: 'peer' },
      signer: peer.signer,
    })
    const tampered = {
      ...env,
      body: { ...(env.body as object), target: ours.artifacts.did, reason: 'injected' },
    } as SignedSignalEnvelope
    const path = signalInboxPath(tmp, peer.artifacts.did, env.id)
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    writeFileSync(path, yamlStringify(tampered))

    const status = await flywayStatus(tmp)
    expect(status.exits.count).toBe(0)
    expect(status.exits.issues.some((i) => /does not verify/.test(i))).toBe(true)
  })
})

describe('flywayStatus — exit-aware agreements (ADR-0013)', () => {
  let tmp: string
  let ours: Murmuration
  let peer: Murmuration
  beforeEach(async () => {
    tmp = freshTmp()
    ours = await makeMurmuration('xeeban', 'us')
    peer = await makeMurmuration('emergent', 'them')
    seedOursWithRecognizedPeer(tmp, ours, peer)
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports fileState and a matching effectiveState for a live agreement', async () => {
    writeAgreement(tmp, 'live-agr', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
    })
    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'live-agr')
    expect(a?.fileState).toBe('in-flight')
    expect(a?.effectiveState).toBe('in-flight')
    expect(a?.closure).toBeUndefined()
    expect(status.agreements.closedCount).toBe(0)
  })

  it('treats a file already marked closed as effectively closed with no exit closure', async () => {
    writeAgreement(tmp, 'done-agr', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'closed',
    })
    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'done-agr')
    expect(a?.effectiveState).toBe('closed')
    expect(a?.closure).toBeUndefined()
    expect(status.agreements.closedCount).toBe(1)
  })

  it('supersedes an in-flight agreement to closed when a peer exit targets a participant', async () => {
    writeAgreement(tmp, 'peer-closed', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
    })
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: peer.artifacts.did, targetType: 'peer' },
      signer: ours.signer,
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'peer-closed')
    expect(a?.fileState).toBe('in-flight')
    expect(a?.effectiveState).toBe('closed')
    expect(a?.closure?.via).toBe('peer')
    expect(a?.closure?.direction).toBe('we-exited')
    expect(status.agreements.closedCount).toBe(1)
  })

  it('closes only the agreements whose projectId matches a project exit', async () => {
    writeAgreement(tmp, 'in-projX', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
      projectId: 'projX',
    })
    writeAgreement(tmp, 'in-projY', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
      projectId: 'projY',
    })
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: 'projX', targetType: 'project' },
      signer: ours.signer,
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const x = status.agreements.entries.find((e) => e.id === 'in-projX')
    const y = status.agreements.entries.find((e) => e.id === 'in-projY')
    expect(x?.effectiveState).toBe('closed')
    expect(x?.closure?.via).toBe('project')
    expect(x?.closure?.target).toBe('projX')
    expect(y?.effectiveState).toBe('in-flight')
    expect(status.agreements.closedCount).toBe(1)
  })

  it('does not close an agreement the exiting peer is not a participant of', async () => {
    writeAgreement(tmp, 'other-parties', {
      participants: [ours.artifacts.did, 'did:web:github.com:someone:else'],
      state: 'in-flight',
    })
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: peer.artifacts.did, targetType: 'peer' },
      signer: ours.signer,
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'other-parties')
    expect(a?.effectiveState).toBe('in-flight')
    expect(a?.closure).toBeUndefined()
  })

  it('closes a syndicateId-tagged agreement on a matching syndicate exit', async () => {
    writeAgreement(tmp, 'in-guild', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
      syndicateId: 'guild-7',
    })
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: 'guild-7', targetType: 'syndicate' },
      signer: ours.signer,
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'in-guild')
    expect(a?.effectiveState).toBe('closed')
    expect(a?.closure?.via).toBe('syndicate')
    expect(a?.closure?.target).toBe('guild-7')
  })

  it('does NOT close an agreement created after the exit (temporal guard)', async () => {
    // We exited the peer on 2026-06-01, then formed a NEW agreement later —
    // exit does not retract recognition, so re-collaboration is normal and
    // the stale exit must not close the newer agreement.
    writeAgreement(tmp, 'formed-before', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
      createdAt: '2026-05-01T00:00:00.000Z',
    })
    writeAgreement(tmp, 'formed-after', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: peer.artifacts.did, targetType: 'peer' },
      signer: ours.signer,
      now: new Date('2026-06-01T00:00:00.000Z'),
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const before = status.agreements.entries.find((e) => e.id === 'formed-before')
    const after = status.agreements.entries.find((e) => e.id === 'formed-after')
    expect(before?.effectiveState).toBe('closed')
    expect(after?.effectiveState).toBe('in-flight')
    expect(after?.closure).toBeUndefined()
  })

  it('flags a project exit whose target matches no agreement (typo advisory)', async () => {
    writeAgreement(tmp, 'in-aurora', {
      participants: [ours.artifacts.did, peer.artifacts.did],
      state: 'in-flight',
      projectId: 'aurora-2026',
    })
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: 'aurora-206', targetType: 'project' }, // transposed digit
      signer: ours.signer,
    })
    writeSignalToOutbox(tmp, env)

    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'in-aurora')
    expect(a?.effectiveState).toBe('in-flight')
    expect(status.exits.issues.some((i) => /matched no agreement/.test(i))).toBe(true)
  })

  it('flags an unknown lifecycle state and does not treat it as a real state', async () => {
    writeAgreement(tmp, 'weird', {
      participants: [ours.artifacts.did],
      state: 'banana',
    })
    const status = await flywayStatus(tmp)
    const a = status.agreements.entries.find((e) => e.id === 'weird')
    expect(a?.fileState).toBeUndefined()
    expect(a?.issues.some((i) => /unknown agreement state/.test(i))).toBe(true)
  })
})

describe('flywayStatus — exit trust-gate hardening (review)', () => {
  let tmp: string
  let ours: Murmuration
  let peer: Murmuration
  beforeEach(async () => {
    tmp = freshTmp()
    ours = await makeMurmuration('xeeban', 'us')
    peer = await makeMurmuration('emergent', 'them')
    seedOursWithRecognizedPeer(tmp, ours, peer)
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('refuses a peer-signed exit placed under the WRONG inbox subtree (cross-peer replay)', async () => {
    // The peer genuinely signed an exit to us; an attacker copies it into a
    // different sender's inbox subtree. The placement check must reject it.
    const env = await createExit({
      from: peer.artifacts.did,
      to: ours.artifacts.did,
      body: { target: ours.artifacts.did, targetType: 'peer' },
      signer: peer.signer,
    })
    // Place under a THIRD party's segments instead of the peer's.
    placeInboxFileAt(tmp, 'did:web:github.com:attacker:m', env.id, env)

    const status = await flywayStatus(tmp)
    expect(status.exits.count).toBe(0)
    expect(status.exits.issues.some((i) => /not under sender/.test(i))).toBe(true)
    const p = status.peers.entries.find((e) => e.did === peer.artifacts.did)
    expect(p?.closure).toBeUndefined()
  })

  it('refuses a valid peer exit addressed to a third party (wrong-recipient replay)', async () => {
    const env = await createExit({
      from: peer.artifacts.did,
      to: 'did:web:github.com:someone:else',
      body: { target: 'did:web:github.com:someone:else', targetType: 'peer' },
      signer: peer.signer,
    })
    // Correctly placed under the peer's subtree, but not addressed to us.
    placeInboxFileAt(tmp, peer.artifacts.did, env.id, env)

    const status = await flywayStatus(tmp)
    expect(status.exits.count).toBe(0)
    expect(status.exits.issues.some((i) => /not us/.test(i))).toBe(true)
  })

  it('refuses an inbox exit dated before recognition (retroactive)', async () => {
    const env = await createExit({
      from: peer.artifacts.did,
      to: ours.artifacts.did,
      body: { target: ours.artifacts.did, targetType: 'peer' },
      signer: peer.signer,
      now: new Date('2026-01-01T00:00:00.000Z'), // before recognizedAt 2026-05-21
    })
    writeSignalToInbox(tmp, env)

    const status = await flywayStatus(tmp)
    expect(status.exits.count).toBe(0)
    expect(status.exits.issues.some((i) => /not after recognizedAt/.test(i))).toBe(true)
  })

  it('refuses an outbox exit whose signature does not verify as ours', async () => {
    // A file appears in our outbox that we did not authentically sign
    // (e.g. slipped in by a mis-merged PR). It must not be trusted as a
    // "we-exited" closure just because it sits in the outbox.
    const env = await createExit({
      from: ours.artifacts.did,
      to: peer.artifacts.did,
      body: { target: peer.artifacts.did, targetType: 'peer', reason: 'authentic' },
      signer: ours.signer,
    })
    const forged = {
      ...env,
      body: { ...(env.body as object), reason: 'tampered' },
    } as SignedSignalEnvelope
    const outPath = join(
      tmp,
      'flyway',
      'outbox',
      ...peer.artifacts.did.replace(/^did:web:/, '').split(':'),
      `${env.id}.yaml`,
    )
    mkdirSync(outPath.slice(0, outPath.lastIndexOf('/')), { recursive: true })
    writeFileSync(outPath, yamlStringify(forged))

    const status = await flywayStatus(tmp)
    expect(status.exits.count).toBe(0)
    expect(
      status.exits.issues.some((i) => /does not verify against our DID document/.test(i)),
    ).toBe(true)
    const p = status.peers.entries.find((e) => e.did === peer.artifacts.did)
    expect(p?.closure).toBeUndefined()
  })
})

describe('flywayStatus — inbox summary (Issue #17)', () => {
  let tmp: string
  let ours: Murmuration
  let peer: Murmuration
  beforeEach(async () => {
    tmp = freshTmp()
    ours = await makeMurmuration('xeeban', 'us')
    peer = await makeMurmuration('emergent', 'them')
    seedOursWithRecognizedPeer(tmp, ours, peer)
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports an empty inbox as zero across the board', async () => {
    const status = await flywayStatus(tmp)
    expect(status.inbox).toEqual({ total: 0, verified: 0, flagged: 0 })
  })

  it('counts a verified signal from a recognized peer', async () => {
    const env = await buildSignedSignal({
      from: peer.artifacts.did,
      to: ours.artifacts.did,
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y' },
      signer: peer.signer,
      id: 'peer-tension-1',
      now: new Date('2026-05-25T12:00:00.000Z'),
    })
    writeSignalToInbox(tmp, env)

    const status = await flywayStatus(tmp)
    expect(status.inbox.total).toBe(1)
    expect(status.inbox.verified).toBe(1)
    expect(status.inbox.flagged).toBe(0)
  })

  it('flags a signal from an unrecognized sender', async () => {
    const stranger = await makeMurmuration('stranger', 's')
    const env = await buildSignedSignal({
      from: stranger.artifacts.did,
      to: ours.artifacts.did,
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y' },
      signer: stranger.signer,
      id: 'stranger-tension-1',
      now: new Date('2026-05-25T12:00:00.000Z'),
    })
    writeSignalToInbox(tmp, env)

    const status = await flywayStatus(tmp)
    expect(status.inbox.total).toBe(1)
    expect(status.inbox.verified).toBe(0)
    expect(status.inbox.flagged).toBe(1)
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flywayCheck } from './check.js'
import { flywayInit } from './init.js'
import { fingerprintEntityStatement } from './recognize.js'
import { buildSignedSignal, signalInboxPath, writeSignalToInbox } from './signal.js'
import { localEd25519Signer } from './signing.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-check-test-'))
}

async function makeMurmuration(owner: string, name: string) {
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
 * Seed `cwd` with: our identity files, a peers.yaml entry for `peer`,
 * and the cached peer DID document. Mirrors what flyway init + flyway
 * recognize would produce, without going through the CLI.
 */
async function seedReceiverWithRecognizedPeer(cwd: string, peer: {
  artifacts: { did: string; didDocument: unknown; entityStatement: unknown }
}, ours: { artifacts: { did: string; didDocument: unknown; entityStatement: unknown } }) {
  // Own identity
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
  // Peer cache
  const peerSegs = peer.artifacts.did.replace(/^did:web:/, '').split(':')
  const peerCache = join(cwd, 'flyway', 'peers', ...peerSegs)
  mkdirSync(peerCache, { recursive: true })
  writeFileSync(
    join(peerCache, 'did.json'),
    JSON.stringify(peer.artifacts.didDocument, null, 2),
  )
  writeFileSync(
    join(peerCache, 'entity-statement.json'),
    JSON.stringify(peer.artifacts.entityStatement, null, 2),
  )
  // Minimal peers.yaml — note: signature is fake but flywayCheck only
  // looks up the DID, not the recognition signature.
  const fp = fingerprintEntityStatement(
    peer.artifacts.entityStatement as Parameters<typeof fingerprintEntityStatement>[0],
  )
  const peerKey = (peer.artifacts.didDocument as { verificationMethod: { publicKeyJwk: { x: string } }[] })
    .verificationMethod[0]!.publicKeyJwk.x
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

describe('flywayCheck — empty inbox', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns zero signals when the inbox directory does not exist', async () => {
    const result = await flywayCheck(tmp)
    expect(result.totalCount).toBe(0)
    expect(result.signals).toEqual([])
    expect(result.issues).toEqual([])
  })
})

describe('flywayCheck — signal from a recognized peer', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('verifies signatures against cached peer DID document and counts valid signals', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const sender = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, sender, recipient)

    const env = await buildSignedSignal({
      from: sender.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y', relevance: 'Z' },
      signer: sender.signer,
      id: 'tension-001',
    })
    writeSignalToInbox(tmp, env)

    const result = await flywayCheck(tmp)
    expect(result.totalCount).toBe(1)
    expect(result.validCount).toBe(1)
    const entry = result.signals[0]!
    expect(entry.kind).toBe('tension')
    expect(entry.fromRecognized).toBe(true)
    expect(entry.signatureValid).toBe(true)
    expect(entry.fromPathMatchesEnvelope).toBe(true)
    expect(entry.issues).toEqual([])
  })

  it('flags a tampered envelope as signature-invalid', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const sender = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, sender, recipient)

    const env = await buildSignedSignal({
      from: sender.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'tension',
      body: { conditions: 'original' },
      signer: sender.signer,
      id: 'tension-002',
    })
    writeSignalToInbox(tmp, env)
    // Tamper with the on-disk file
    const path = signalInboxPath(tmp, sender.artifacts.did, 'tension-002')
    const existing = (await import('node:fs')).readFileSync(path, 'utf-8')
    writeFileSync(path, existing.replace('original', 'tampered'))

    const result = await flywayCheck(tmp)
    expect(result.signals[0]?.signatureValid).toBe(false)
    expect(result.validCount).toBe(0)
  })
})

describe('flywayCheck — signal from an unrecognized sender', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('flags unrecognized senders and refuses to verify their signatures', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const stranger = await makeMurmuration('unknown', 'stranger')
    // Only write our own identity — no peers.yaml entry for stranger.
    mkdirSync(join(tmp, '.well-known'), { recursive: true })
    writeFileSync(
      join(tmp, '.well-known', 'did.json'),
      JSON.stringify(recipient.artifacts.didDocument, null, 2),
    )

    const env = await buildSignedSignal({
      from: stranger.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'proposal',
      body: { stage: 'final' },
      signer: stranger.signer,
      id: 'unknown-1',
    })
    writeSignalToInbox(tmp, env)

    const result = await flywayCheck(tmp)
    expect(result.totalCount).toBe(1)
    expect(result.validCount).toBe(0)
    const entry = result.signals[0]!
    expect(entry.fromRecognized).toBe(false)
    expect(entry.signatureValid).toBeUndefined()
    expect(entry.issues.some((i) => /not in flyway\/peers/.test(i))).toBe(true)
  })
})

describe('flywayCheck — misplaced signals', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('flags a signal whose path does not match envelope.from', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const sender = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, sender, recipient)

    const env = await buildSignedSignal({
      from: sender.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'tension',
      body: {},
      signer: sender.signer,
      id: 'mp-001',
    })
    // Write into the WRONG inbox directory (under a different DID's
    // path), simulating either a misbehaving transport or a file in the
    // wrong place.
    const wrongDir = join(tmp, 'flyway', 'inbox', 'github.com', 'wrong', 'place')
    mkdirSync(wrongDir, { recursive: true })
    writeFileSync(
      join(wrongDir, 'mp-001.yaml'),
      `schema: flyway-signal-v0\n${(await import('yaml')).stringify(env).slice(0)}`,
    )

    const result = await flywayCheck(tmp)
    const entry = result.signals.find(
      (s) => s.envelope.id === 'mp-001',
    )
    expect(entry).toBeDefined()
    expect(entry?.fromPathMatchesEnvelope).toBe(false)
    expect(
      entry?.issues.some((i) => /not in the expected inbox/.test(i)),
    ).toBe(true)
  })
})

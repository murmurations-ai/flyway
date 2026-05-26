import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flywayCheck } from './check.js'
import { flywayInit } from './init.js'
import { fingerprintEntityStatement } from './recognize.js'
import {
  buildSignedSignal,
  signalInboxPath,
  writeSignalToInbox,
  writeSignalToOutbox,
} from './signal.js'
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

describe('flywayCheck — sentAt vs recognizedAt ordering', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('flags a signal whose sentAt predates the peer recognizedAt (no retroactive validation)', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const sender = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, sender, recipient)
    // seedReceiverWithRecognizedPeer hardcodes recognizedAt=2026-05-21T00:00:00.000Z;
    // sign a tension dated *before* that.
    const env = await buildSignedSignal({
      from: sender.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y' },
      signer: sender.signer,
      id: 'predates-1',
      now: new Date('2026-04-01T00:00:00.000Z'),
    })
    writeSignalToInbox(tmp, env)

    const result = await flywayCheck(tmp)
    expect(result.totalCount).toBe(1)
    expect(result.validCount).toBe(0)
    const entry = result.signals[0]!
    expect(entry.signatureValid).toBe(true) // signature itself is valid
    expect(
      entry.issues.some((i) => /predates peer recognizedAt/.test(i)),
    ).toBe(true)
  })
})

describe('flywayCheck — refs.tensionId resolution (Issue #14 / G7)', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('accepts a respond signal whose refs.tensionId resolves to a real tension in our outbox', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const responder = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, responder, recipient)

    // We previously sent responder a tension (now in our outbox).
    const ourTension = await buildSignedSignal({
      from: recipient.artifacts.did,
      to: responder.artifacts.did,
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y' },
      signer: recipient.signer,
      id: 'our-tension-1',
      now: new Date('2026-05-25T12:00:00.000Z'),
    })
    writeSignalToOutbox(tmp, ourTension)

    // Responder signs back a respond signal pointing at it.
    const theirResponse = await buildSignedSignal({
      from: responder.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'respond',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 'our-tension-1', inReplyTo: 'our-tension-1' },
      signer: responder.signer,
      id: 'their-response-1',
      now: new Date('2026-05-25T12:30:00.000Z'),
    })
    writeSignalToInbox(tmp, theirResponse)

    const result = await flywayCheck(tmp)
    expect(result.totalCount).toBe(1)
    expect(result.validCount).toBe(1)
    expect(result.signals[0]?.issues).toEqual([])
  })

  it("flags a respond signal whose refs.tensionId doesn't exist in our outbox (fabricated reference)", async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const responder = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, responder, recipient)

    // No prior tension in our outbox. Responder claims to be replying anyway.
    const fabricated = await buildSignedSignal({
      from: responder.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'respond',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 'never-existed', inReplyTo: 'never-existed' },
      signer: responder.signer,
      id: 'fabricated-1',
      now: new Date('2026-05-25T12:30:00.000Z'),
    })
    writeSignalToInbox(tmp, fabricated)

    const result = await flywayCheck(tmp)
    expect(result.totalCount).toBe(1)
    expect(result.validCount).toBe(0)
    const issues = result.signals[0]?.issues ?? []
    expect(issues.some((i) => /no matching signal in our outbox/.test(i))).toBe(true)
  })

  it("flags a respond signal whose refs.tensionId resolves to a tension we sent to someone else", async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const responder = await makeMurmuration('emergent', 'p')
    const third = await makeMurmuration('third', 'party')
    await seedReceiverWithRecognizedPeer(tmp, responder, recipient)

    // Our outbox: a tension to `third`, not to `responder`.
    const tensionToThird = await buildSignedSignal({
      from: recipient.artifacts.did,
      to: third.artifacts.did,
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y' },
      signer: recipient.signer,
      id: 'sent-to-third',
      now: new Date('2026-05-25T12:00:00.000Z'),
    })
    writeSignalToOutbox(tmp, tensionToThird)

    // Responder claims to respond to a tension that was actually for third.
    // (Won't actually find the file at responder's outbox path, so this
    // fires the "no matching signal" branch — refs are looked up under the
    // SENDER's segments, which is responder, not third.)
    const misdirected = await buildSignedSignal({
      from: responder.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'respond',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 'sent-to-third' },
      signer: responder.signer,
      id: 'misdirected-1',
      now: new Date('2026-05-25T12:30:00.000Z'),
    })
    writeSignalToInbox(tmp, misdirected)

    const result = await flywayCheck(tmp)
    const issues = result.signals[0]?.issues ?? []
    expect(issues.some((i) => /no matching signal in our outbox/.test(i))).toBe(true)
    expect(result.validCount).toBe(0)
  })

  it('flags a respond signal that has no refs.tensionId at all', async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const responder = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, responder, recipient)

    const noRefs = await buildSignedSignal({
      from: responder.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'respond',
      body: { decision: 'acknowledge' },
      // intentionally no refs
      signer: responder.signer,
      id: 'no-refs-1',
      now: new Date('2026-05-25T12:30:00.000Z'),
    })
    writeSignalToInbox(tmp, noRefs)

    const result = await flywayCheck(tmp)
    const issues = result.signals[0]?.issues ?? []
    expect(issues.some((i) => /missing refs\.tensionId/.test(i))).toBe(true)
    expect(result.validCount).toBe(0)
  })

  it("flags a respond signal whose refs.tensionId resolves to a non-tension signal", async () => {
    const recipient = await makeMurmuration('xeeban', 'r')
    const responder = await makeMurmuration('emergent', 'p')
    await seedReceiverWithRecognizedPeer(tmp, responder, recipient)

    // Seed a non-tension (a respond, even) at the outbox path the refs lookup
    // would query. This simulates a corrupted outbox or a malicious refs.
    const wrongKindAtOutbox = await buildSignedSignal({
      from: recipient.artifacts.did,
      to: responder.artifacts.did,
      kind: 'respond',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 'wrong-kind-here' },
      signer: recipient.signer,
      id: 'wrong-kind-here',
      now: new Date('2026-05-25T11:00:00.000Z'),
    })
    writeSignalToOutbox(tmp, wrongKindAtOutbox)

    const respondToWrongKind = await buildSignedSignal({
      from: responder.artifacts.did,
      to: recipient.artifacts.did,
      kind: 'respond',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 'wrong-kind-here' },
      signer: responder.signer,
      id: 'respond-to-wrong-1',
      now: new Date('2026-05-25T12:30:00.000Z'),
    })
    writeSignalToInbox(tmp, respondToWrongKind)

    const result = await flywayCheck(tmp)
    const target = result.signals.find((s) => s.envelope.id === 'respond-to-wrong-1')
    expect(target).toBeDefined()
    const issues = target?.issues ?? []
    expect(issues.some((i) => /resolves to a respond signal, not a tension/.test(i))).toBe(true)
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

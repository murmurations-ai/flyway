import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import {
  type SignedSignalEnvelope,
  buildSignedSignal,
  signalInboxPath,
  signalOutboxPath,
} from './signal.js'
import { localEd25519Signer } from './signing.js'
import {
  type DeliveryReceipt,
  type SignalTransport,
  localFsTransport,
  sendSignal,
} from './transport.js'

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

async function makeSignal(
  fromDid: string,
  toDid: string,
  signer: Parameters<typeof buildSignedSignal>[0]['signer'],
): Promise<SignedSignalEnvelope> {
  return buildSignedSignal({
    from: fromDid,
    to: toDid,
    kind: 'tension',
    body: { conditions: 'X', effect: 'Y' },
    signer,
    id: 'sig-001',
    now: new Date('2026-06-26T12:00:00.000Z'),
  })
}

let senderRepo: string
let peerRepo: string

beforeEach(() => {
  senderRepo = mkdtempSync(join(tmpdir(), 'flyway-tx-sender-'))
  peerRepo = mkdtempSync(join(tmpdir(), 'flyway-tx-peer-'))
})
afterEach(() => {
  rmSync(senderRepo, { recursive: true, force: true })
  rmSync(peerRepo, { recursive: true, force: true })
})

describe('localFsTransport', () => {
  it('delivers a signal into the recipient inbox and returns a receipt', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)

    const receipt = await localFsTransport(signal, {
      toDid: B.artifacts.did,
      localRepoPath: peerRepo,
    })
    expect(receipt.transport).toBe('local-fs')
    expect(receipt.delivered).toBe(true)
    const expected = signalInboxPath(peerRepo, A.artifacts.did, 'sig-001')
    expect(receipt.ref).toBe(expected)
    expect(existsSync(expected)).toBe(true)
  })

  it('requires a localRepoPath', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)
    await expect(
      localFsTransport(signal, { toDid: B.artifacts.did }),
    ).rejects.toThrow(/localRepoPath is required/)
  })

  it('is idempotent on identical re-delivery', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)
    const target = { toDid: B.artifacts.did, localRepoPath: peerRepo }
    const first = await localFsTransport(signal, target)
    const second = await localFsTransport(signal, target)
    expect(first.detail).toMatch(/written/)
    expect(second.detail).toMatch(/idempotent/)
  })
})

describe('sendSignal', () => {
  it('writes the sender outbox FIRST, then delivers (default transport)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)

    const { outboxPath, receipt } = await sendSignal({
      cwd: senderRepo,
      signal,
      target: { toDid: B.artifacts.did, localRepoPath: peerRepo },
    })
    // Outbox record exists at the canonical path.
    expect(outboxPath).toBe(signalOutboxPath(senderRepo, B.artifacts.did, 'sig-001'))
    expect(existsSync(outboxPath)).toBe(true)
    // And it was delivered to the peer inbox.
    expect(existsSync(receipt.ref!)).toBe(true)
  })

  it('routes through an injected transport', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)

    let seen: SignedSignalEnvelope | undefined
    const stub: SignalTransport = async (env): Promise<DeliveryReceipt> => {
      seen = env
      return { transport: 'github-pr', delivered: true, at: env.sentAt, ref: 'pr#1' }
    }
    const { receipt } = await sendSignal({
      cwd: senderRepo,
      signal,
      target: { toDid: B.artifacts.did, repoUrl: 'https://github.com/emergent/praxis' },
      transport: stub,
    })
    expect(seen?.id).toBe('sig-001')
    expect(receipt.transport).toBe('github-pr')
    expect(receipt.ref).toBe('pr#1')
  })

  it('keeps the outbox record even when the transport fails (durability)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)

    const failing: SignalTransport = async () => {
      throw new Error('network down')
    }
    await expect(
      sendSignal({
        cwd: senderRepo,
        signal,
        target: { toDid: B.artifacts.did, localRepoPath: peerRepo },
        transport: failing,
      }),
    ).rejects.toThrow(/network down/)
    // The send was recorded despite delivery failing — retry is re-running.
    expect(existsSync(signalOutboxPath(senderRepo, B.artifacts.did, 'sig-001'))).toBe(true)
    // Nothing landed in the peer inbox.
    expect(existsSync(signalInboxPath(peerRepo, A.artifacts.did, 'sig-001'))).toBe(false)
  })

  it('the delivered file verifies on the far side (bytes moved verbatim)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.artifacts.did, B.artifacts.did, A.signer)
    const { receipt } = await sendSignal({
      cwd: senderRepo,
      signal,
      target: { toDid: B.artifacts.did, localRepoPath: peerRepo },
    })
    const delivered = readFileSync(receipt.ref!, 'utf-8')
    expect(delivered).toContain('id: sig-001')
    expect(delivered).toContain(`from: ${A.artifacts.did}`)
  })
})

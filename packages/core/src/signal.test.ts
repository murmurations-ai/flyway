import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import {
  buildSignedSignal,
  domainForSignalKind,
  generateSignalId,
  readSignalFile,
  signalInboxPath,
  signalOutboxPath,
  verifySignedSignal,
  writeSignalToInbox,
  writeSignalToOutbox,
} from './signal.js'
import {
  DOMAIN_EXIT,
  DOMAIN_PROPOSAL,
  DOMAIN_RESPOND,
  DOMAIN_TENSION,
  localEd25519Signer,
} from './signing.js'

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

describe('domainForSignalKind', () => {
  it('maps each kind to its distinct domain tag', () => {
    expect(domainForSignalKind('tension')).toBe(DOMAIN_TENSION)
    expect(domainForSignalKind('proposal')).toBe(DOMAIN_PROPOSAL)
    expect(domainForSignalKind('respond')).toBe(DOMAIN_RESPOND)
    expect(domainForSignalKind('exit')).toBe(DOMAIN_EXIT)
  })
})

describe('generateSignalId', () => {
  it('produces ids that match the documented charset', () => {
    expect(generateSignalId()).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
  })

  it('produces time-sortable ids', () => {
    const t0 = new Date('2026-05-01T00:00:00Z')
    const t1 = new Date('2026-05-02T00:00:00Z')
    expect(generateSignalId(t0) < generateSignalId(t1)).toBe(true)
  })
})

describe('buildSignedSignal + verifySignedSignal', () => {
  it('round-trips through verify under the kind-specific domain', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'tension',
      body: { conditions: 'X', effect: 'Y' },
      signer: A.signer,
    })
    expect(env.kind).toBe('tension')
    expect(env.schema).toBe('flyway-signal-v0')
    expect(env.signature.domain).toBe(DOMAIN_TENSION)
    const ok = await verifySignedSignal(env, A.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('verification fails if envelope.kind is mutated post-signing', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'proposal',
      body: { stage: 'final' },
      signer: A.signer,
    })
    const tampered = { ...env, kind: 'tension' } as typeof env
    const ok = await verifySignedSignal(tampered, A.artifacts.didDocument)
    expect(ok).toBe(false)
  })

  it('verification fails when the signature.domain does not match the kind', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'proposal',
      body: { stage: 'final' },
      signer: A.signer,
    })
    const tampered = {
      ...env,
      signature: { ...env.signature, domain: DOMAIN_TENSION },
    }
    const ok = await verifySignedSignal(tampered, A.artifacts.didDocument)
    expect(ok).toBe(false)
  })

  it('accepts a provided id and records refs', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'respond',
      body: { decision: 'accept' },
      signer: A.signer,
      id: 'fixed-id-123',
      refs: { proposalId: 'prop-1', inReplyTo: 'prop-1' },
    })
    expect(env.id).toBe('fixed-id-123')
    expect(env.refs?.proposalId).toBe('prop-1')
  })

  it('rejects ids outside the documented charset', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      buildSignedSignal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        kind: 'tension',
        body: {},
        signer: A.signer,
        id: 'has spaces',
      }),
    ).rejects.toThrow(/charset|id must match/)
  })
})

describe('inbox / outbox writers', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'flyway-signal-test-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes a signal under flyway/inbox/<host>/<owner>/<repo>/<id>.yaml', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'tension',
      body: { x: 1 },
      signer: A.signer,
      id: 'aaa',
    })
    const result = writeSignalToInbox(tmp, env)
    expect(result.path).toBe(signalInboxPath(tmp, A.artifacts.did, 'aaa'))
    const text = readFileSync(result.path, 'utf-8')
    expect(text).toContain('schema: flyway-signal-v0')
    expect(text).toContain('kind: tension')
  })

  it('writes a signal under flyway/outbox/<host>/<owner>/<repo>/<id>.yaml', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'proposal',
      body: { stage: 'final' },
      signer: A.signer,
      id: 'bbb',
    })
    const result = writeSignalToOutbox(tmp, env)
    expect(result.path).toBe(
      signalOutboxPath(tmp, 'did:web:github.com:emergent:praxis', 'bbb'),
    )
  })

  it('is idempotent when re-writing the same signed envelope', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'tension',
      body: { x: 1 },
      signer: A.signer,
      id: 'ccc',
    })
    const first = writeSignalToInbox(tmp, env)
    const second = writeSignalToInbox(tmp, env)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
  })

  it('refuses to overwrite an existing file with a different signature', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env1 = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'tension',
      body: { x: 1 },
      signer: A.signer,
      id: 'reuse-id',
    })
    const env2 = await buildSignedSignal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      kind: 'tension',
      body: { x: 2 },
      signer: A.signer,
      id: 'reuse-id',
    })
    writeSignalToInbox(tmp, env1)
    expect(() => writeSignalToInbox(tmp, env2)).toThrow(/id reuse|refusing to overwrite/)
  })

  it('readSignalFile returns null for malformed files', () => {
    const path = join(tmp, 'not-a-signal.yaml')
    writeFileSync(path, 'just: random\ncontent: true\n')
    expect(readSignalFile(path)).toBeNull()
  })
})

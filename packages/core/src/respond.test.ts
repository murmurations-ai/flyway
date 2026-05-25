import { describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import { createTensionResponse } from './respond.js'
import { verifySignedSignal } from './signal.js'
import { DOMAIN_RESPOND, localEd25519Signer } from './signing.js'

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

describe('createTensionResponse — happy paths', () => {
  it('builds and signs an acknowledge response that verifies under DOMAIN_RESPOND', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: 'did:web:github.com:xeeban:a',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 'prior-tension-1' },
      signer: B.signer,
    })
    expect(env.kind).toBe('respond')
    expect(env.signature.domain).toBe(DOMAIN_RESPOND)
    expect((env.body as { decision: string }).decision).toBe('acknowledge')
    expect(env.refs?.tensionId).toBe('prior-tension-1')
    // inReplyTo defaults to the tension id.
    expect(env.refs?.inReplyTo).toBe('prior-tension-1')
    const ok = await verifySignedSignal(env, B.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('preserves an explicit inReplyTo when supplied', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: 'did:web:github.com:xeeban:a',
      body: { decision: 'acknowledge', reason: 'opt-in clarity' },
      refs: { tensionId: 't1', inReplyTo: 'earlier-thread-root' },
      signer: B.signer,
    })
    expect(env.refs?.inReplyTo).toBe('earlier-thread-root')
    expect(env.refs?.tensionId).toBe('t1')
  })

  it('signs a transfer with transferTo', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: 'did:web:github.com:xeeban:a',
      body: {
        decision: 'transfer',
        reason: 'belongs to the platform circle',
        transferTo: 'did:web:github.com:other:circle',
      },
      refs: { tensionId: 't1' },
      signer: B.signer,
    })
    const body = env.body as Record<string, unknown>
    expect(body.decision).toBe('transfer')
    expect(body.transferTo).toBe('did:web:github.com:other:circle')
  })

  it('omits transferTo when decision is not transfer', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: 'did:web:github.com:xeeban:a',
      body: { decision: 'dispute', reason: 'not a real driver yet' },
      refs: { tensionId: 't1' },
      signer: B.signer,
    })
    expect('transferTo' in (env.body as object)).toBe(false)
  })
})

describe('createTensionResponse — validation', () => {
  it('rejects an unknown decision', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: 'did:web:github.com:xeeban:a',
        // biome-ignore lint/suspicious/noExplicitAny: validating runtime input shape
        body: { decision: 'maybe' as any },
        refs: { tensionId: 't1' },
        signer: B.signer,
      }),
    ).rejects.toThrow(/decision must be one of/)
  })

  it('rejects dispute / dissolve / transfer with no reason', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    for (const decision of ['dispute', 'dissolve', 'transfer'] as const) {
      await expect(
        createTensionResponse({
          from: B.artifacts.did,
          to: 'did:web:github.com:xeeban:a',
          body:
            decision === 'transfer'
              ? { decision, transferTo: 'did:web:github.com:x:y' }
              : { decision },
          refs: { tensionId: 't1' },
          signer: B.signer,
        }),
      ).rejects.toThrow(/requires a non-empty reason/)
    }
  })

  it("rejects transferTo on non-'transfer' decisions", async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: 'did:web:github.com:xeeban:a',
        body: {
          decision: 'acknowledge',
          transferTo: 'did:web:github.com:x:y',
        },
        refs: { tensionId: 't1' },
        signer: B.signer,
      }),
    ).rejects.toThrow(/transferTo is only valid when decision === 'transfer'/)
  })

  it("rejects 'transfer' decisions with no transferTo", async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: 'did:web:github.com:xeeban:a',
        body: { decision: 'transfer', reason: 'belongs elsewhere' },
        refs: { tensionId: 't1' },
        signer: B.signer,
      }),
    ).rejects.toThrow(/transferTo/)
  })

  it('rejects an empty tensionId — a response must point at a subject', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: 'did:web:github.com:xeeban:a',
        body: { decision: 'acknowledge' },
        refs: { tensionId: '' },
        signer: B.signer,
      }),
    ).rejects.toThrow(/tensionId/)
  })

  it('rejects cross-kind replay — a response cannot pose as a tension', async () => {
    const B = await makeMurmuration('emergent', 'praxis')
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: 'did:web:github.com:xeeban:a',
      body: { decision: 'acknowledge' },
      refs: { tensionId: 't1' },
      signer: B.signer,
    })
    const tampered = { ...env, kind: 'tension' as const }
    const ok = await verifySignedSignal(tampered, B.artifacts.didDocument)
    expect(ok).toBe(false)
  })
})

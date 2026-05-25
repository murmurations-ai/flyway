import { describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import { verifySignedSignal } from './signal.js'
import { DOMAIN_TENSION, localEd25519Signer } from './signing.js'
import { createTension } from './tension.js'

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

describe('createTension', () => {
  it('produces a signed tension envelope that round-trips through verify', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createTension({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: {
        conditions: 'Sprint reviews are running 90 minutes over.',
        effect: 'Team is losing focus before the retrospective starts.',
      },
      signer: A.signer,
    })
    expect(env.kind).toBe('tension')
    expect(env.signature.domain).toBe(DOMAIN_TENSION)
    expect(env.from).toBe(A.artifacts.did)
    expect(env.to).toBe('did:web:github.com:emergent:praxis')
    const ok = await verifySignedSignal(env, A.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('preserves optional fields when provided', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createTension({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: {
        conditions: 'X',
        effect: 'Y',
        relevance: 'Z',
        proposedOwner: 'did:web:github.com:other:repo',
      },
      signer: A.signer,
    })
    const body = env.body as Record<string, unknown>
    expect(body.relevance).toBe('Z')
    expect(body.proposedOwner).toBe('did:web:github.com:other:repo')
  })

  it('omits optional fields when absent (does not emit undefined keys)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createTension({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { conditions: 'X', effect: 'Y' },
      signer: A.signer,
    })
    const body = env.body as Record<string, unknown>
    expect('relevance' in body).toBe(false)
    expect('proposedOwner' in body).toBe(false)
  })

  it('passes through refs (e.g. inReplyTo)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createTension({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { conditions: 'X', effect: 'Y' },
      signer: A.signer,
      refs: { inReplyTo: 'prior-signal-id' },
    })
    expect(env.refs?.inReplyTo).toBe('prior-signal-id')
  })

  it('rejects empty conditions', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createTension({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { conditions: '', effect: 'Y' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/conditions/)
  })

  it('rejects whitespace-only effect', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createTension({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { conditions: 'X', effect: '   ' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/effect/)
  })

  it('rejects cross-domain replay — a tension cannot pose as another kind', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createTension({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { conditions: 'X', effect: 'Y' },
      signer: A.signer,
    })
    const tampered = { ...env, kind: 'proposal' as const }
    const ok = await verifySignedSignal(tampered, A.artifacts.didDocument)
    expect(ok).toBe(false)
  })
})

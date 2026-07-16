import { describe, expect, it } from 'vitest'
import { EXIT_TARGET_TYPES, createExit } from './exit.js'
import { flywayInit } from './init.js'
import { verifySignedSignal } from './signal.js'
import { DOMAIN_EXIT, DOMAIN_TENSION, localEd25519Signer } from './signing.js'

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

const PEER = 'did:web:github.com:emergent:praxis'

describe('EXIT_TARGET_TYPES', () => {
  it('lists the three target types', () => {
    expect(EXIT_TARGET_TYPES).toEqual(['peer', 'project', 'syndicate'])
  })
})

describe('createExit', () => {
  it('produces a signed peer-exit envelope that round-trips through verify', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createExit({
      from: A.artifacts.did,
      to: PEER,
      body: { target: PEER, targetType: 'peer' },
      signer: A.signer,
    })
    expect(env.kind).toBe('exit')
    expect(env.signature.domain).toBe(DOMAIN_EXIT)
    expect(env.from).toBe(A.artifacts.did)
    expect(env.to).toBe(PEER)
    const ok = await verifySignedSignal(env, A.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('signs a project exit with the project id as target', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createExit({
      from: A.artifacts.did,
      to: PEER,
      body: {
        target: 'retro-cadence-2026',
        targetType: 'project',
        reason: 'Cadence no longer fits.',
      },
      signer: A.signer,
    })
    const body = env.body as Record<string, unknown>
    expect(body.target).toBe('retro-cadence-2026')
    expect(body.targetType).toBe('project')
    expect(body.reason).toBe('Cadence no longer fits.')
    expect(await verifySignedSignal(env, A.artifacts.didDocument)).toBe(true)
  })

  it('omits reason when absent (does not emit an undefined key)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createExit({
      from: A.artifacts.did,
      to: PEER,
      body: { target: PEER, targetType: 'peer' },
      signer: A.signer,
    })
    expect('reason' in (env.body as Record<string, unknown>)).toBe(false)
  })

  it('carries a distinct domain tag — an exit signature cannot be replayed as a tension', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createExit({
      from: A.artifacts.did,
      to: PEER,
      body: { target: PEER, targetType: 'peer' },
      signer: A.signer,
    })
    expect(env.signature.domain).toBe(DOMAIN_EXIT)
    expect(env.signature.domain).not.toBe(DOMAIN_TENSION)
    // Forcing the kind to 'tension' without re-signing must fail verification.
    const forged = { ...env, kind: 'tension' as const }
    expect(await verifySignedSignal(forged, A.artifacts.didDocument)).toBe(false)
  })

  it('rejects an unknown targetType', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createExit({
        from: A.artifacts.did,
        to: PEER,
        body: { target: PEER, targetType: 'galaxy' as never },
        signer: A.signer,
      }),
    ).rejects.toThrow(/targetType must be one of/)
  })

  it('rejects an empty target', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createExit({
        from: A.artifacts.did,
        to: PEER,
        body: { target: '   ', targetType: 'project' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/target must be a non-empty string/)
  })

  it("refuses a peer exit whose target isn't the recipient", async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createExit({
        from: A.artifacts.did,
        to: PEER,
        body: { target: 'did:web:github.com:someone:else', targetType: 'peer' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/must equal the recipient/)
  })

  it('rejects a present-but-empty reason', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createExit({
        from: A.artifacts.did,
        to: PEER,
        body: { target: PEER, targetType: 'peer', reason: '  ' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/reason must be a non-empty string/)
  })
})

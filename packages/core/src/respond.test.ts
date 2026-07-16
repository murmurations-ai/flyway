import { describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import { createProposal, type ProposalBody } from './propose.js'
import { createProposalResponse, createTensionResponse } from './respond.js'
import { type SignedSignalEnvelope, buildSignedSignal, verifySignedSignal } from './signal.js'
import { DOMAIN_RESPOND, localEd25519Signer } from './signing.js'
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

interface Fixture {
  A: Awaited<ReturnType<typeof makeMurmuration>>
  B: Awaited<ReturnType<typeof makeMurmuration>>
  tension: SignedSignalEnvelope
}

async function fixture(): Promise<Fixture> {
  const A = await makeMurmuration('xeeban', 'a')
  const B = await makeMurmuration('emergent', 'praxis')
  const tension = await createTension({
    from: A.artifacts.did,
    to: B.artifacts.did,
    body: { conditions: 'X', effect: 'Y' },
    signer: A.signer,
  })
  return { A, B, tension }
}

describe('createTensionResponse — happy paths', () => {
  it('builds and signs an acknowledge response that verifies under DOMAIN_RESPOND', async () => {
    const { A, B, tension } = await fixture()
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { decision: 'acknowledge' },
      refs: { tensionId: tension.id },
      subjectEnvelope: tension,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    expect(env.kind).toBe('respond')
    expect(env.signature.domain).toBe(DOMAIN_RESPOND)
    expect((env.body as { decision: string }).decision).toBe('acknowledge')
    expect(env.refs?.tensionId).toBe(tension.id)
    expect(env.refs?.inReplyTo).toBe(tension.id)
    const ok = await verifySignedSignal(env, B.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('preserves an explicit inReplyTo when supplied', async () => {
    const { A, B, tension } = await fixture()
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { decision: 'acknowledge', reason: 'opt-in clarity' },
      refs: { tensionId: tension.id, inReplyTo: 'earlier-thread-root' },
      subjectEnvelope: tension,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    expect(env.refs?.inReplyTo).toBe('earlier-thread-root')
    expect(env.refs?.tensionId).toBe(tension.id)
  })

  it('signs a transfer with transferTo', async () => {
    const { A, B, tension } = await fixture()
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: {
        decision: 'transfer',
        reason: 'belongs to the platform circle',
        transferTo: 'did:web:github.com:other:circle',
      },
      refs: { tensionId: tension.id },
      subjectEnvelope: tension,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    const body = env.body as Record<string, unknown>
    expect(body.decision).toBe('transfer')
    expect(body.transferTo).toBe('did:web:github.com:other:circle')
  })

  it('omits transferTo when decision is not transfer', async () => {
    const { A, B, tension } = await fixture()
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { decision: 'dispute', reason: 'not a real driver yet' },
      refs: { tensionId: tension.id },
      subjectEnvelope: tension,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    expect('transferTo' in (env.body as object)).toBe(false)
  })
})

describe('createTensionResponse — body validation', () => {
  it('rejects an unknown decision', async () => {
    const { A, B, tension } = await fixture()
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'maybe' as never },
        refs: { tensionId: tension.id },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/decision must be one of/)
  })

  it('rejects dispute / dissolve / transfer with no reason', async () => {
    const { A, B, tension } = await fixture()
    for (const decision of ['dispute', 'dissolve', 'transfer'] as const) {
      await expect(
        createTensionResponse({
          from: B.artifacts.did,
          to: A.artifacts.did,
          body:
            decision === 'transfer'
              ? { decision, transferTo: 'did:web:github.com:x:y' }
              : { decision },
          refs: { tensionId: tension.id },
          subjectEnvelope: tension,
          subjectSenderDidDocument: A.artifacts.didDocument,
          signer: B.signer,
        }),
      ).rejects.toThrow(/requires a non-empty reason/)
    }
  })

  it("rejects transferTo on non-'transfer' decisions", async () => {
    const { A, B, tension } = await fixture()
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge', transferTo: 'did:web:github.com:x:y' },
        refs: { tensionId: tension.id },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/transferTo is only valid when decision === 'transfer'/)
  })

  it("rejects 'transfer' decisions with no transferTo", async () => {
    const { A, B, tension } = await fixture()
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'transfer', reason: 'belongs elsewhere' },
        refs: { tensionId: tension.id },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/transferTo/)
  })

  it('rejects an empty tensionId — a response must point at a subject', async () => {
    const { A, B, tension } = await fixture()
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: '' },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/tensionId/)
  })
})

describe('createTensionResponse — antecedent verification (ADR-0009)', () => {
  it("rejects when subjectEnvelope.kind is not 'tension'", async () => {
    const { A, B, tension } = await fixture()
    // Build a non-tension envelope from A (a stray proposal-shaped signal).
    const stray = await buildSignedSignal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      kind: 'proposal',
      body: { stage: 'final' },
      signer: A.signer,
    })
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: stray.id },
        subjectEnvelope: stray,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/subjectEnvelope\.kind must be 'tension'/)
    // Ensure the tension fixture still works (no shared state).
    expect(tension.kind).toBe('tension')
  })

  it('rejects when refs.tensionId does not match subjectEnvelope.id', async () => {
    const { A, B, tension } = await fixture()
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: 'completely-made-up' },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/refs\.tensionId .* does not match subjectEnvelope\.id/)
  })

  it("rejects when subjectEnvelope.from is not the response's 'to'", async () => {
    const { A, B, tension } = await fixture()
    const C = await makeMurmuration('third', 'party')
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: C.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: tension.id },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/responses go back to the subject's sender/)
  })

  it('rejects when subjectSenderDidDocument.id does not match subjectEnvelope.from', async () => {
    const { A, B, tension } = await fixture()
    const C = await makeMurmuration('third', 'party')
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: tension.id },
        subjectEnvelope: tension,
        // Wrong DID document supplied — would normally be a confused-deputy bug.
        subjectSenderDidDocument: C.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/subjectSenderDidDocument\.id .* does not match subjectEnvelope\.from/)
  })

  it('rejects when subjectEnvelope signature does not verify (tampered body)', async () => {
    const { A, B, tension } = await fixture()
    const tampered: SignedSignalEnvelope = {
      ...tension,
      body: { conditions: 'TAMPERED', effect: 'Y' },
    }
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: tampered.id },
        subjectEnvelope: tampered,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/Refusing to respond to a tampered or stale tension/)
  })

  it('rejects when the supplied DID document carries an attacker-controlled key', async () => {
    // Concrete simulation of SEC-2: an attacker supplies a DID doc with
    // the recognized DID *string* but a different public key, plus a
    // tension signed with the matching attacker key. If we ever pass
    // such a doc, the antecedent-verification step must catch the
    // mismatch via subjectSenderDidDocument.id check.
    const { A, B } = await fixture()
    const attacker = await makeMurmuration('attacker', 'evil')
    const forged = await createTension({
      from: A.artifacts.did, // claims to be A
      to: B.artifacts.did,
      body: { conditions: 'fake', effect: 'fake' },
      signer: attacker.signer, // but signed with attacker's key
    })
    // Attacker hands B a DID doc that says id=attacker but pretends to
    // be authoritative for A's tension. Our doc-vs-subject.from check
    // refuses.
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: forged.id },
        subjectEnvelope: forged,
        subjectSenderDidDocument: attacker.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/does not match subjectEnvelope\.from/)
    // And if the attacker tries to use A's *real* DID doc with their
    // forged tension, the signature verify fails.
    await expect(
      createTensionResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'acknowledge' },
        refs: { tensionId: forged.id },
        subjectEnvelope: forged,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/Refusing to respond to a tampered or stale tension/)
  })
})

describe('createTensionResponse — cross-kind replay', () => {
  it('rejects cross-kind replay — a response cannot pose as a tension', async () => {
    const { A, B, tension } = await fixture()
    const env = await createTensionResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { decision: 'acknowledge' },
      refs: { tensionId: tension.id },
      subjectEnvelope: tension,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    const tampered = { ...env, kind: 'tension' as const }
    const ok = await verifySignedSignal(tampered, B.artifacts.didDocument)
    expect(ok).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════
// createProposalResponse (S+5)
// ════════════════════════════════════════════════════════════════════════

interface ProposalFixture {
  A: Awaited<ReturnType<typeof makeMurmuration>>
  B: Awaited<ReturnType<typeof makeMurmuration>>
  proposal: SignedSignalEnvelope
}

async function proposalFixture(): Promise<ProposalFixture> {
  const A = await makeMurmuration('xeeban', 'a')
  const B = await makeMurmuration('emergent', 'praxis')
  const proposal = await createProposal({
    from: A.artifacts.did,
    to: B.artifacts.did,
    body: {
      type: 'directive',
      title: 'Weekly retro',
      body: 'Please attend the weekly retro on Fridays.',
    },
    signer: A.signer,
    id: 'proposal-1',
  })
  return { A, B, proposal }
}

describe('createProposalResponse — happy paths', () => {
  it('signs an accept response that verifies under DOMAIN_RESPOND', async () => {
    const { A, B, proposal } = await proposalFixture()
    const env = await createProposalResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { decision: 'accept' },
      refs: { proposalId: proposal.id },
      subjectEnvelope: proposal,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    expect(env.kind).toBe('respond')
    expect(env.signature.domain).toBe(DOMAIN_RESPOND)
    expect((env.body as { decision: string }).decision).toBe('accept')
    expect(env.refs?.proposalId).toBe(proposal.id)
    expect(env.refs?.inReplyTo).toBe(proposal.id)
    const ok = await verifySignedSignal(env, B.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('signs an object response with a reason', async () => {
    const { A, B, proposal } = await proposalFixture()
    const env = await createProposalResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { decision: 'object', reason: 'Fridays conflict with our planning' },
      refs: { proposalId: proposal.id },
      subjectEnvelope: proposal,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    const body = env.body as { decision: string; reason: string }
    expect(body.decision).toBe('object')
    expect(body.reason).toBe('Fridays conflict with our planning')
  })

  it('records concernsToRecord (Issues #3 + #15)', async () => {
    const { A, B, proposal } = await proposalFixture()
    const env = await createProposalResponse({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: {
        decision: 'accept',
        concernsToRecord: [
          'Verify the retro cadence at the first review',
          'Check whether async option is needed for Praxis members in EU',
        ],
      },
      refs: { proposalId: proposal.id },
      subjectEnvelope: proposal,
      subjectSenderDidDocument: A.artifacts.didDocument,
      signer: B.signer,
    })
    const body = env.body as { concernsToRecord: string[] }
    expect(body.concernsToRecord).toHaveLength(2)
  })
})

describe('createProposalResponse — body validation', () => {
  it('rejects an unknown decision', async () => {
    const { A, B, proposal } = await proposalFixture()
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'maybe' as never },
        refs: { proposalId: proposal.id },
        subjectEnvelope: proposal,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/decision must be one of/)
  })

  it('rejects object / exit with no reason', async () => {
    const { A, B, proposal } = await proposalFixture()
    for (const decision of ['object', 'exit'] as const) {
      await expect(
        createProposalResponse({
          from: B.artifacts.did,
          to: A.artifacts.did,
          body: { decision },
          refs: { proposalId: proposal.id },
          subjectEnvelope: proposal,
          subjectSenderDidDocument: A.artifacts.didDocument,
          signer: B.signer,
        }),
      ).rejects.toThrow(/requires a non-empty reason/)
    }
  })

  it('rejects empty concernsToRecord array', async () => {
    const { A, B, proposal } = await proposalFixture()
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'accept', concernsToRecord: [] },
        refs: { proposalId: proposal.id },
        subjectEnvelope: proposal,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/non-empty array of strings/)
  })

  it('rejects empty proposalId', async () => {
    const { A, B, proposal } = await proposalFixture()
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'accept' },
        refs: { proposalId: '' },
        subjectEnvelope: proposal,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/proposalId/)
  })
})

describe('createProposalResponse — antecedent verification (ADR-0009)', () => {
  it("rejects when subjectEnvelope.kind is not 'proposal'", async () => {
    const { A, B } = await proposalFixture()
    const tension = await createTension({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: A.signer,
    })
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'accept' },
        refs: { proposalId: tension.id },
        subjectEnvelope: tension,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/subjectEnvelope\.kind must be 'proposal'/)
  })

  it("rejects when refs.proposalId doesn't match subjectEnvelope.id", async () => {
    const { A, B, proposal } = await proposalFixture()
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'accept' },
        refs: { proposalId: 'fabricated' },
        subjectEnvelope: proposal,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/refs\.proposalId .* does not match subjectEnvelope\.id/)
  })

  it("rejects when subjectEnvelope.from is not the response's 'to'", async () => {
    const { A, B, proposal } = await proposalFixture()
    const C = await makeMurmuration('third', 'party')
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: C.artifacts.did,
        body: { decision: 'accept' },
        refs: { proposalId: proposal.id },
        subjectEnvelope: proposal,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/responses go back to the subject's sender/)
  })

  it('rejects a tampered subject (body mutated post-signing)', async () => {
    const { A, B, proposal } = await proposalFixture()
    const tampered: SignedSignalEnvelope = {
      ...proposal,
      body: { ...(proposal.body as ProposalBody), title: 'CHANGED' },
    }
    await expect(
      createProposalResponse({
        from: B.artifacts.did,
        to: A.artifacts.did,
        body: { decision: 'accept' },
        refs: { proposalId: tampered.id },
        subjectEnvelope: tampered,
        subjectSenderDidDocument: A.artifacts.didDocument,
        signer: B.signer,
      }),
    ).rejects.toThrow(/tampered or stale proposal/)
  })
})

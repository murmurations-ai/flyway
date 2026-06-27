import { beforeAll, describe, expect, it } from 'vitest'
import {
  type FlywayAgreement,
  FLYWAY_AGREEMENT_SCHEMA_VERSION,
} from './agreements.js'
import { flywayInit } from './init.js'
import {
  type ProposalAgreementBody,
  type ProposalAntecedent,
  type ProposalBody,
  type ProposalDirectiveBody,
  PROPOSAL_STAGES,
  PROPOSAL_TYPES,
  createProposal,
  isValidStageTransition,
} from './propose.js'
import { verifySignedSignal } from './signal.js'
import { DOMAIN_PROPOSAL, localEd25519Signer } from './signing.js'
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

function exampleAgreement(participants: readonly string[]): FlywayAgreement {
  return {
    id: 'agreement-001',
    schemaVersion: FLYWAY_AGREEMENT_SCHEMA_VERSION,
    createdAt: '2026-05-26T12:00:00.000Z',
    participants,
    driver: {
      conditions: 'Sprint retrospectives are running over.',
      effect: 'Cross-circle tensions surface in governance rounds instead.',
    },
    purpose: 'Hold weekly retros that surface tensions before they reach governance.',
    expectations: participants.map((p) => ({
      participant: p,
      description: 'Attend the weekly retro at the agreed cadence.',
    })),
    decisionRule: 's3-consent',
    review: { cadence: 'monthly' },
    exit: { notice: '30 days' },
    state: 'proposed',
  }
}

function directive(
  partial: Partial<ProposalDirectiveBody> = {},
): ProposalDirectiveBody {
  return {
    type: 'directive',
    title: 'Send weekly status digest',
    body: 'Please send the project digest every Friday at 17:00 UTC.',
    ...partial,
  }
}

// ────────────────────────────────────────────────────────────────────────
// PROPOSAL_TYPES / PROPOSAL_STAGES sanity
// ────────────────────────────────────────────────────────────────────────

describe('PROPOSAL_TYPES / PROPOSAL_STAGES', () => {
  it('lists the three proposal types', () => {
    expect(PROPOSAL_TYPES).toEqual(['directive', 'project', 'agreement'])
  })

  it('lists the five proposal stages in canonical order', () => {
    expect(PROPOSAL_STAGES).toEqual([
      'driver',
      'requirements',
      'draft',
      'refinement',
      'final',
    ])
  })
})

// ────────────────────────────────────────────────────────────────────────
// isValidStageTransition (Issue #8)
// ────────────────────────────────────────────────────────────────────────

describe('isValidStageTransition', () => {
  it('permits same-stage iteration (refinement → refinement)', () => {
    expect(isValidStageTransition('refinement', 'refinement')).toBe(true)
  })

  it('permits the canonical chain driver → requirements → draft → refinement → final', () => {
    expect(isValidStageTransition('driver', 'requirements')).toBe(true)
    expect(isValidStageTransition('requirements', 'draft')).toBe(true)
    expect(isValidStageTransition('draft', 'refinement')).toBe(true)
    expect(isValidStageTransition('refinement', 'final')).toBe(true)
  })

  it('permits skip-aheads (driver → final, draft → final)', () => {
    expect(isValidStageTransition('driver', 'final')).toBe(true)
    expect(isValidStageTransition('draft', 'final')).toBe(true)
  })

  it('refuses backwards transitions', () => {
    expect(isValidStageTransition('draft', 'requirements')).toBe(false)
    expect(isValidStageTransition('refinement', 'draft')).toBe(false)
    expect(isValidStageTransition('final', 'refinement')).toBe(false)
  })

  it('final is terminal (no successors)', () => {
    for (const s of PROPOSAL_STAGES) {
      expect(isValidStageTransition('final', s)).toBe(false)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────
// createProposal — happy paths
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — happy paths', () => {
  it('signs a single-stage directive proposal that verifies under DOMAIN_PROPOSAL', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: directive(),
      signer: A.signer,
    })
    expect(env.kind).toBe('proposal')
    expect(env.signature.domain).toBe(DOMAIN_PROPOSAL)
    const body = env.body as ProposalBody
    expect(body.type).toBe('directive')
    expect(body.stage).toBe('final') // default
    expect(env.refs).toBeUndefined()
    const ok = await verifySignedSignal(env, A.artifacts.didDocument)
    expect(ok).toBe(true)
  })

  it('signs an agreement proposal whose body conforms to FLYWAY_AGREEMENT_SCHEMA', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const env = await createProposal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: {
        type: 'agreement',
        title: 'Weekly retro agreement',
        body: 'See structured agreement body.',
        agreement: exampleAgreement([A.artifacts.did, B.artifacts.did]),
      },
      signer: A.signer,
    })
    const body = env.body as ProposalAgreementBody
    expect(body.agreement.schemaVersion).toBe(FLYWAY_AGREEMENT_SCHEMA_VERSION)
    expect(body.agreement.participants).toContain(A.artifacts.did)
    expect(body.agreement.participants).toContain(B.artifacts.did)
  })

  it("signs a requirements-stage proposal with structured requirements (Issue #6)", async () => {
    const A = await makeMurmuration('xeeban', 'a')
    // Build a chain: driver → requirements
    const driverProposal = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'driver' },
      signer: A.signer,
      id: 'driver-001',
    })
    const reqsEnv = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: {
        ...directive(),
        stage: 'requirements',
        previousStageId: 'driver-001',
        requirements: [
          { id: 'r1', description: 'Digest is delivered by Friday 17:00 UTC.', mustOrShould: 'must' },
          { id: 'r2', description: 'Digest under 500 words.', mustOrShould: 'should' },
        ],
      },
      signer: A.signer,
      proposalAntecedent: {
        envelope: driverProposal,
        senderDidDocument: A.artifacts.didDocument,
      },
    })
    const body = reqsEnv.body as ProposalBody
    expect(body.stage).toBe('requirements')
    expect(body.requirements).toHaveLength(2)
    expect(reqsEnv.refs?.proposalId).toBe('driver-001')
    expect(reqsEnv.refs?.inReplyTo).toBe('driver-001')
  })

  it('signs a tension-promoted proposal carrying refs.tensionId', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    // B previously sent A a tension; A now promotes it into a proposal back to B.
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
      id: 'tension-001',
    })
    const proposal = await createProposal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: directive(),
      signer: A.signer,
      tensionAntecedent: {
        envelope: tension,
        senderDidDocument: B.artifacts.didDocument,
      },
    })
    expect(proposal.refs?.tensionId).toBe('tension-001')
    expect(proposal.refs?.inReplyTo).toBe('tension-001')
  })

  it('chains through a refinement (Issue #8)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const draft = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'draft' },
      signer: A.signer,
      id: 'draft-001',
    })
    const refinement = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'refinement', previousStageId: 'draft-001' },
      signer: A.signer,
      proposalAntecedent: {
        envelope: draft,
        senderDidDocument: A.artifacts.didDocument,
      },
    })
    const body = refinement.body as ProposalBody
    expect(body.stage).toBe('refinement')
    expect(refinement.refs?.proposalId).toBe('draft-001')
  })
})

// ────────────────────────────────────────────────────────────────────────
// Base-field validation
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — base field validation', () => {
  let A: Awaited<ReturnType<typeof makeMurmuration>>
  beforeAll(async () => {
    A = await makeMurmuration('xeeban', 'a')
  })

  it('rejects unknown types', async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        // biome-ignore lint/suspicious/noExplicitAny: validating runtime input
        body: { ...directive(), type: 'maybe' as any },
        signer: A.signer,
      }),
    ).rejects.toThrow(/type must be one of/)
  })

  it('rejects empty title or body', async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), title: '' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/title/)
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), body: '   ' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/body\.body/)
  })

  it('rejects unknown stages', async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        // biome-ignore lint/suspicious/noExplicitAny: validating runtime input
        body: { ...directive(), stage: 'almost-final' as any },
        signer: A.signer,
      }),
    ).rejects.toThrow(/stage must be one of/)
  })

  it('rejects malformed deadlines', async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), deadline: 'next Friday' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/deadline/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// Agreement-specific validation (Issue #7 + schema)
// ────────────────────────────────────────────────────────────────────────

describe("createProposal — type='agreement' validation", () => {
  it('rejects missing structured agreement', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        // biome-ignore lint/suspicious/noExplicitAny: validating runtime input
        body: { type: 'agreement', title: 'X', body: 'Y' } as any,
        signer: A.signer,
      }),
    ).rejects.toThrow(/requires body\.agreement/)
  })

  it('rejects agreement with wrong schemaVersion', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const ag = {
      ...exampleAgreement([A.artifacts.did, B.artifacts.did]),
      schemaVersion: '99.0.0',
    }
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: { type: 'agreement', title: 'X', body: 'Y', agreement: ag },
        signer: A.signer,
      }),
    ).rejects.toThrow(/schemaVersion/)
  })

  it('rejects agreement whose participants exclude the sender', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const ag = exampleAgreement([B.artifacts.did, 'did:web:github.com:third:party'])
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: { type: 'agreement', title: 'X', body: 'Y', agreement: ag },
        signer: A.signer,
      }),
    ).rejects.toThrow(/participants must include the sender/)
  })

  it('rejects agreement whose participants exclude the recipient', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const ag = exampleAgreement([A.artifacts.did, 'did:web:github.com:third:party'])
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: { type: 'agreement', title: 'X', body: 'Y', agreement: ag },
        signer: A.signer,
      }),
    ).rejects.toThrow(/participants must include the recipient/)
  })

  it('rejects agreement with unknown decisionRule', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const ag = {
      ...exampleAgreement([A.artifacts.did, B.artifacts.did]),
      decisionRule: 'oligarchy' as never,
    }
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: { type: 'agreement', title: 'X', body: 'Y', agreement: ag },
        signer: A.signer,
      }),
    ).rejects.toThrow(/decisionRule must be one of/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// Stage validation (Issue #6 + #8)
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — stage validation', () => {
  let A: Awaited<ReturnType<typeof makeMurmuration>>
  beforeAll(async () => {
    A = await makeMurmuration('xeeban', 'a')
  })

  it("requires structured requirements when stage='requirements' (Issue #6)", async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), stage: 'requirements', previousStageId: 'd-1' },
        signer: A.signer,
        proposalAntecedent: {
          envelope: await createProposal({
            from: A.artifacts.did,
            to: 'did:web:github.com:emergent:praxis',
            body: { ...directive(), stage: 'driver' },
            signer: A.signer,
            id: 'd-1',
          }),
          senderDidDocument: A.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/non-empty body\.requirements array/)
  })

  it('rejects requirements list on non-requirements stages', async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: {
          ...directive(),
          stage: 'draft',
          requirements: [{ id: 'r1', description: 'x' }],
        },
        signer: A.signer,
      }),
    ).rejects.toThrow(/only valid at stage='requirements'/)
  })

  it("requires previousStageId when stage='refinement'", async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), stage: 'refinement' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/requires body\.previousStageId/)
  })

  it('rejects invalid stage transitions (Issue #8 — refinement → requirements)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const refinementProposal = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'draft' },
      signer: A.signer,
      id: 'd-2',
    })
    const refinementChain = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'refinement', previousStageId: 'd-2' },
      signer: A.signer,
      proposalAntecedent: {
        envelope: refinementProposal,
        senderDidDocument: A.artifacts.didDocument,
      },
      id: 'ref-1',
    })
    // refinement → requirements is invalid
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: {
          ...directive(),
          stage: 'requirements',
          previousStageId: 'ref-1',
          requirements: [{ id: 'r1', description: 'x' }],
        },
        signer: A.signer,
        proposalAntecedent: {
          envelope: refinementChain,
          senderDidDocument: A.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/invalid stage transition/)
  })

  it("rejects previousStageId mismatch with proposalAntecedent.envelope.id", async () => {
    const draft = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'draft' },
      signer: A.signer,
      id: 'd-real',
    })
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), stage: 'refinement', previousStageId: 'd-fake' },
        signer: A.signer,
        proposalAntecedent: {
          envelope: draft,
          senderDidDocument: A.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/does not match proposalAntecedent/)
  })

  it('rejects previousStageId without a proposalAntecedent (ADR-0009)', async () => {
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), stage: 'draft', previousStageId: 'd-1' },
        signer: A.signer,
      }),
    ).rejects.toThrow(/requires proposalAntecedent/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// ADR-0009 antecedent verification
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — antecedent verification (ADR-0009)', () => {
  it('rejects a tension antecedent whose kind is wrong', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    // Build a proposal and try to pass it as a tension antecedent.
    const fakeTension = await createProposal({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: directive(),
      signer: B.signer,
      id: 'not-a-tension',
    })
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: directive(),
        signer: A.signer,
        tensionAntecedent: {
          envelope: fakeTension,
          senderDidDocument: B.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/tensionAntecedent\.envelope\.kind must be 'tension'/)
  })

  it("rejects a tension antecedent with mismatched senderDidDocument", async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const C = await makeMurmuration('third', 'party')
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
    })
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: directive(),
        signer: A.signer,
        tensionAntecedent: {
          envelope: tension,
          senderDidDocument: C.artifacts.didDocument, // wrong
        },
      }),
    ).rejects.toThrow(/does not match envelope\.from/)
  })

  it('rejects a tampered tension antecedent', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
    })
    const tampered = { ...tension, body: { conditions: 'TAMPERED', effect: 'Y' } }
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: directive(),
        signer: A.signer,
        tensionAntecedent: {
          envelope: tampered,
          senderDidDocument: B.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/tampered or stale tension/)
  })

  it('rejects a tampered proposal antecedent', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const draft = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: { ...directive(), stage: 'draft' },
      signer: A.signer,
      id: 'd-3',
    })
    const tampered = { ...draft, body: { ...(draft.body as ProposalBody), title: 'CHANGED' } }
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: 'did:web:github.com:emergent:praxis',
        body: { ...directive(), stage: 'refinement', previousStageId: 'd-3' },
        signer: A.signer,
        proposalAntecedent: {
          envelope: tampered,
          senderDidDocument: A.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/tampered or stale proposal/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// Cross-kind replay protection
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — cross-kind replay protection', () => {
  it('rejects mutating envelope.kind after signing', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const env = await createProposal({
      from: A.artifacts.did,
      to: 'did:web:github.com:emergent:praxis',
      body: directive(),
      signer: A.signer,
    })
    const tampered = { ...env, kind: 'tension' as const }
    const ok = await verifySignedSignal(tampered, A.artifacts.didDocument)
    expect(ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────
// Agreement provenance — originTensionId (Issue #2)
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — agreement provenance (Issue #2)', () => {
  it('propagates refs.tensionId forward through the staging chain', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    // B raises a tension; A promotes it at the driver stage.
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
      id: 'tension-001',
    })
    const driver = await createProposal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: { ...directive(), stage: 'driver' },
      signer: A.signer,
      id: 'driver-001',
      tensionAntecedent: {
        envelope: tension,
        senderDidDocument: B.artifacts.didDocument,
      },
    })
    expect(driver.refs?.tensionId).toBe('tension-001')
    // A later stage built only from the driver still names the tension —
    // the link survives without re-supplying the tension antecedent.
    const draft = await createProposal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: { ...directive(), stage: 'draft', previousStageId: 'driver-001' },
      signer: A.signer,
      proposalAntecedent: {
        envelope: driver,
        senderDidDocument: A.artifacts.didDocument,
      },
    })
    expect(draft.refs?.tensionId).toBe('tension-001')
    expect(draft.refs?.proposalId).toBe('driver-001')
  })

  it('accepts a final agreement whose originTensionId matches the chain tension', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
      id: 'tension-001',
    })
    const env = await createProposal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: {
        type: 'agreement',
        title: 'Weekly retro agreement',
        body: 'See structured agreement body.',
        agreement: {
          ...exampleAgreement([A.artifacts.did, B.artifacts.did]),
          originTensionId: 'tension-001',
        },
      },
      signer: A.signer,
      tensionAntecedent: {
        envelope: tension,
        senderDidDocument: B.artifacts.didDocument,
      },
    })
    const body = env.body as ProposalAgreementBody
    expect(body.agreement.originTensionId).toBe('tension-001')
    expect(env.refs?.tensionId).toBe('tension-001')
  })

  it('auto-stamps originTensionId on a final agreement from the chain tension', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
      id: 'tension-001',
    })
    // Proposer does NOT restate originTensionId — it is derived from the
    // verified tension carried through the chain.
    const env = await createProposal({
      from: A.artifacts.did,
      to: B.artifacts.did,
      body: {
        type: 'agreement',
        title: 'Weekly retro agreement',
        body: 'See structured agreement body.',
        stage: 'final',
        agreement: exampleAgreement([A.artifacts.did, B.artifacts.did]),
      },
      signer: A.signer,
      tensionAntecedent: {
        envelope: tension,
        senderDidDocument: B.artifacts.didDocument,
      },
    })
    const body = env.body as ProposalAgreementBody
    expect(body.agreement.originTensionId).toBe('tension-001')
  })

  it('rejects originTensionId with no verified tension in the chain', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: {
          type: 'agreement',
          title: 'Weekly retro agreement',
          body: 'See structured agreement body.',
          agreement: {
            ...exampleAgreement([A.artifacts.did, B.artifacts.did]),
            originTensionId: 'tension-001',
          },
        },
        signer: A.signer,
      }),
    ).rejects.toThrow(/no verified.*tension|claims a tension origin/)
  })

  it('rejects originTensionId that mismatches the chain tension', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const tension = await createTension({
      from: B.artifacts.did,
      to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' },
      signer: B.signer,
      id: 'tension-001',
    })
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: {
          type: 'agreement',
          title: 'Weekly retro agreement',
          body: 'See structured agreement body.',
          agreement: {
            ...exampleAgreement([A.artifacts.did, B.artifacts.did]),
            originTensionId: 'tension-999',
          },
        },
        signer: A.signer,
        tensionAntecedent: {
          envelope: tension,
          senderDidDocument: B.artifacts.didDocument,
        },
      }),
    ).rejects.toThrow(/does not match the verified/)
  })

  it('rejects a tensionAntecedent that diverges from the tension the chain already carries', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    // B raises two tensions; A promotes T1 into a driver-stage chain.
    const t1 = await createTension({
      from: B.artifacts.did, to: A.artifacts.did,
      body: { conditions: 'X', effect: 'Y' }, signer: B.signer, id: 'tension-001',
    })
    const t2 = await createTension({
      from: B.artifacts.did, to: A.artifacts.did,
      body: { conditions: 'P', effect: 'Q' }, signer: B.signer, id: 'tension-002',
    })
    const driver = await createProposal({
      from: A.artifacts.did, to: B.artifacts.did,
      body: { ...directive(), stage: 'driver' }, signer: A.signer, id: 'driver-001',
      tensionAntecedent: { envelope: t1, senderDidDocument: B.artifacts.didDocument },
    })
    // Now build a final agreement that chains from the driver (carries T1) but
    // ALSO supplies a divergent fresh promotion of T2 — must be refused.
    await expect(
      createProposal({
        from: A.artifacts.did, to: B.artifacts.did,
        body: {
          type: 'agreement', title: 'X', body: 'final', stage: 'final',
          previousStageId: 'driver-001',
          agreement: exampleAgreement([A.artifacts.did, B.artifacts.did]),
        },
        signer: A.signer,
        proposalAntecedent: { envelope: driver, senderDidDocument: A.artifacts.didDocument },
        tensionAntecedent: { envelope: t2, senderDidDocument: B.artifacts.didDocument },
      }),
    ).rejects.toThrow(/does not match the tension already carried/)
  })

  it('rejects a malformed originTensionId', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    await expect(
      createProposal({
        from: A.artifacts.did,
        to: B.artifacts.did,
        body: {
          type: 'agreement',
          title: 'Weekly retro agreement',
          body: 'See structured agreement body.',
          agreement: {
            ...exampleAgreement([A.artifacts.did, B.artifacts.did]),
            originTensionId: 'not a valid id!',
          },
        },
        signer: A.signer,
      }),
    ).rejects.toThrow(/originTensionId must match/)
  })
})

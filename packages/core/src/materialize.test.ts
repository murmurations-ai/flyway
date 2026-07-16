import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument, stringify as yamlStringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type FlywayAgreement, FLYWAY_AGREEMENT_SCHEMA_VERSION } from './agreements.js'
import { flywayInit } from './init.js'
import {
  type MaterializedAgreement,
  agreementFilePath,
  buildAgreementSigningTarget,
  materializeAgreement,
  signAgreement,
  verifyAgreementSignature,
  writeAgreementFile,
} from './materialize.js'
import { type ProposalAgreementBody, createProposal } from './propose.js'
import { type ProposalResponseBody, createProposalResponse } from './respond.js'
import type { SignedSignalEnvelope } from './signal.js'
import { localEd25519Signer } from './signing.js'
import { createTension } from './tension.js'

/** Assert a fixture value is present without a non-null assertion. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('must: expected a defined value')
  return value
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

function exampleAgreement(participants: readonly string[]): FlywayAgreement {
  return {
    id: 'agreement-tier4-001',
    schemaVersion: FLYWAY_AGREEMENT_SCHEMA_VERSION,
    createdAt: '2026-06-09T12:00:00.000Z',
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

type Murmuration = Awaited<ReturnType<typeof makeMurmuration>>

let a: Murmuration
let b: Murmuration

beforeAll(async () => {
  a = await makeMurmuration('xeeban', 'murmuration-a')
  b = await makeMurmuration('emergent', 'praxis')
})

/** Run the consent close: A proposes the final agreement, B accepts. */
async function consentClose(): Promise<{
  proposal: SignedSignalEnvelope
  response: SignedSignalEnvelope
}> {
  const agreement = exampleAgreement([a.artifacts.did, b.artifacts.did])
  const proposal = await createProposal({
    from: a.artifacts.did,
    to: b.artifacts.did,
    body: {
      type: 'agreement',
      title: 'Weekly retro cadence',
      body: 'Final form of the retro cadence agreement.',
      stage: 'final',
      agreement,
    },
    signer: a.signer,
    now: new Date('2026-06-09T12:00:00.000Z'),
  })
  const response = await createProposalResponse({
    from: b.artifacts.did,
    to: a.artifacts.did,
    body: { decision: 'accept' },
    refs: { proposalId: proposal.id },
    subjectEnvelope: proposal,
    subjectSenderDidDocument: a.artifacts.didDocument,
    signer: b.signer,
    now: new Date('2026-06-09T12:05:00.000Z'),
  })
  return { proposal, response }
}

/** Simulate the YAML round trip an envelope makes through outbox/inbox files. */
function yamlRoundTrip(envelope: SignedSignalEnvelope): SignedSignalEnvelope {
  return parseDocument(yamlStringify(envelope)).toJS() as SignedSignalEnvelope
}

// ────────────────────────────────────────────────────────────────────────
// Signature attachment in the senders
// ────────────────────────────────────────────────────────────────────────

describe('createProposal — agreementSignature attachment (S+5b)', () => {
  it('attaches a detached agreement signature at stage=final', async () => {
    const { proposal } = await consentClose()
    const body = proposal.body as ProposalAgreementBody
    expect(body.agreementSignature).toBeDefined()
    expect(body.agreementSignature?.domain).toBe('flyway-v1:agreement')
    const ok = await verifyAgreementSignature(
      body.agreement,
      must(body.agreementSignature),
      a.artifacts.didDocument,
    )
    expect(ok).toBe(true)
  })

  it('does not attach a signature at non-final stages', async () => {
    const agreement = exampleAgreement([a.artifacts.did, b.artifacts.did])
    const proposal = await createProposal({
      from: a.artifacts.did,
      to: b.artifacts.did,
      body: {
        type: 'agreement',
        title: 'Weekly retro cadence',
        body: 'Draft of the retro cadence agreement.',
        stage: 'draft',
        agreement,
      },
      signer: a.signer,
    })
    const body = proposal.body as ProposalAgreementBody
    expect(body.agreementSignature).toBeUndefined()
  })

  it('rejects a caller-supplied agreementSignature', async () => {
    const agreement = exampleAgreement([a.artifacts.did, b.artifacts.did])
    const forged = await signAgreement(agreement, a.signer)
    await expect(
      createProposal({
        from: a.artifacts.did,
        to: b.artifacts.did,
        body: {
          type: 'agreement',
          title: 'Weekly retro cadence',
          body: 'Final form.',
          stage: 'final',
          agreement,
          agreementSignature: forged,
        },
        signer: a.signer,
      }),
    ).rejects.toThrow(/derived by createProposal/)
  })

  it('rejects an agreement id that cannot become a filename', async () => {
    const agreement = {
      ...exampleAgreement([a.artifacts.did, b.artifacts.did]),
      id: '../escape',
    }
    await expect(
      createProposal({
        from: a.artifacts.did,
        to: b.artifacts.did,
        body: {
          type: 'agreement',
          title: 'Weekly retro cadence',
          body: 'Final form.',
          stage: 'final',
          agreement,
        },
        signer: a.signer,
      }),
    ).rejects.toThrow(/agreement.id must match/)
  })
})

describe('createProposalResponse — co-signing on accept (S+5b)', () => {
  it('attaches the responder agreement signature when accepting a final agreement proposal', async () => {
    const { proposal, response } = await consentClose()
    const body = response.body as ProposalResponseBody
    expect(body.agreementSignature).toBeDefined()
    const subjectBody = proposal.body as ProposalAgreementBody
    const ok = await verifyAgreementSignature(
      subjectBody.agreement,
      must(body.agreementSignature),
      b.artifacts.didDocument,
    )
    expect(ok).toBe(true)
  })

  it('does not attach a signature when objecting', async () => {
    const { proposal } = await consentClose()
    const response = await createProposalResponse({
      from: b.artifacts.did,
      to: a.artifacts.did,
      body: { decision: 'object', reason: 'The cadence conflicts with our sprint rhythm.' },
      refs: { proposalId: proposal.id },
      subjectEnvelope: proposal,
      subjectSenderDidDocument: a.artifacts.didDocument,
      signer: b.signer,
    })
    expect((response.body as ProposalResponseBody).agreementSignature).toBeUndefined()
  })

  it('refuses to accept a final agreement proposal with no proposer signature', async () => {
    const { proposal } = await consentClose()
    const strippedBody = { ...(proposal.body as ProposalAgreementBody) }
    delete (strippedBody as Record<string, unknown>).agreementSignature
    const tampered = { ...proposal, body: strippedBody }
    // The envelope signature no longer verifies after tampering — but the
    // agreementSignature check fires first, which is the diagnosable error.
    await expect(
      createProposalResponse({
        from: b.artifacts.did,
        to: a.artifacts.did,
        body: { decision: 'accept' },
        refs: { proposalId: tampered.id },
        subjectEnvelope: tampered,
        subjectSenderDidDocument: a.artifacts.didDocument,
        signer: b.signer,
      }),
    ).rejects.toThrow(/signature does not verify|no agreementSignature/)
  })

  it('rejects a caller-supplied agreementSignature', async () => {
    const { proposal } = await consentClose()
    const subjectBody = proposal.body as ProposalAgreementBody
    const forged = await signAgreement(subjectBody.agreement, b.signer)
    await expect(
      createProposalResponse({
        from: b.artifacts.did,
        to: a.artifacts.did,
        body: { decision: 'accept', agreementSignature: forged },
        refs: { proposalId: proposal.id },
        subjectEnvelope: proposal,
        subjectSenderDidDocument: a.artifacts.didDocument,
        signer: b.signer,
      }),
    ).rejects.toThrow(/derived by createProposalResponse/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// materializeAgreement
// ────────────────────────────────────────────────────────────────────────

describe('materializeAgreement', () => {
  it('produces the co-signed agreement with state=agreed and both signatures', async () => {
    const { proposal, response } = await consentClose()
    const materialized = await materializeAgreement({
      proposalEnvelope: proposal,
      responseEnvelope: response,
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
    expect(materialized.agreement.state).toBe('agreed')
    expect(materialized.agreement.signatures).toHaveLength(2)
    expect(materialized.relativePath).toBe(join('flyway', 'agreements', 'agreement-tier4-001.yaml'))
    expect(materialized.sha256).toMatch(/^[0-9a-f]{64}$/)
    // signedAt pins to the envelopes, not wall-clock.
    const byDid = Object.fromEntries(
      must(materialized.agreement.signatures).map((s) => [s.participant, s]),
    )
    expect(must(byDid[a.artifacts.did]).signedAt).toBe(proposal.sentAt)
    expect(must(byDid[b.artifacts.did]).signedAt).toBe(response.sentAt)
  })

  it('sorts signatures by participant DID', async () => {
    const { proposal, response } = await consentClose()
    const { agreement } = await materializeAgreement({
      proposalEnvelope: proposal,
      responseEnvelope: response,
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
    const participants = must(agreement.signatures).map((s) => s.participant)
    expect(participants).toEqual([...participants].sort())
  })

  it('is byte-identical across both participants (the co-signing claim)', async () => {
    const { proposal, response } = await consentClose()
    // A materializes from its outbox copy of the proposal and inbox copy
    // of the response; B from its inbox copy of the proposal and outbox
    // copy of the response. Each copy has been through a YAML round trip.
    const fromA = await materializeAgreement({
      proposalEnvelope: yamlRoundTrip(proposal),
      responseEnvelope: yamlRoundTrip(response),
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
    const fromB = await materializeAgreement({
      proposalEnvelope: yamlRoundTrip(yamlRoundTrip(proposal)),
      responseEnvelope: yamlRoundTrip(yamlRoundTrip(response)),
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
    expect(fromA.yamlText).toBe(fromB.yamlText)
    expect(fromA.sha256).toBe(fromB.sha256)
  })

  it('the materialized file is independently verifiable from its own contents', async () => {
    const { proposal, response } = await consentClose()
    const { agreement, yamlText } = await materializeAgreement({
      proposalEnvelope: proposal,
      responseEnvelope: response,
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
    // Re-parse the file, rebuild the signing target, verify each embedded
    // signature against the corresponding DID document.
    const parsed = parseDocument(yamlText).toJS() as FlywayAgreement
    expect(buildAgreementSigningTarget(parsed)).toEqual(buildAgreementSigningTarget(agreement))
    for (const sig of must(parsed.signatures)) {
      const didDoc =
        sig.participant === a.artifacts.did ? a.artifacts.didDocument : b.artifacts.didDocument
      const ok = await verifyAgreementSignature(
        parsed,
        {
          verificationKeyId: must(sig.verificationKeyId),
          algorithm: 'EdDSA',
          canonicalization: 'flyway-jcs-v1',
          domain: 'flyway-v1:agreement',
          signature: sig.signature,
        },
        didDoc,
      )
      expect(ok).toBe(true)
    }
  })

  it('refuses a non-accept response', async () => {
    const { proposal } = await consentClose()
    const objection = await createProposalResponse({
      from: b.artifacts.did,
      to: a.artifacts.did,
      body: { decision: 'object', reason: 'Cadence conflicts with sprint rhythm.' },
      refs: { proposalId: proposal.id },
      subjectEnvelope: proposal,
      subjectSenderDidDocument: a.artifacts.didDocument,
      signer: b.signer,
    })
    await expect(
      materializeAgreement({
        proposalEnvelope: proposal,
        responseEnvelope: objection,
        proposerDidDocument: a.artifacts.didDocument,
        responderDidDocument: b.artifacts.didDocument,
      }),
    ).rejects.toThrow(/decision must be 'accept'/)
  })

  it('refuses a response whose refs point at a different proposal', async () => {
    const first = await consentClose()
    const second = await consentClose()
    await expect(
      materializeAgreement({
        proposalEnvelope: first.proposal,
        responseEnvelope: second.response,
        proposerDidDocument: a.artifacts.didDocument,
        responderDidDocument: b.artifacts.didDocument,
      }),
    ).rejects.toThrow(/refs.proposalId/)
  })

  it('refuses a tampered agreement body', async () => {
    const { proposal, response } = await consentClose()
    const body = proposal.body as ProposalAgreementBody
    const tamperedBody = {
      ...body,
      agreement: { ...body.agreement, purpose: 'Something else entirely.' },
    }
    const tampered = { ...proposal, body: tamperedBody } as SignedSignalEnvelope
    await expect(
      materializeAgreement({
        proposalEnvelope: tampered,
        responseEnvelope: response,
        proposerDidDocument: a.artifacts.didDocument,
        responderDidDocument: b.artifacts.didDocument,
      }),
    ).rejects.toThrow(/does not verify/)
  })

  it('refuses swapped DID documents', async () => {
    const { proposal, response } = await consentClose()
    await expect(
      materializeAgreement({
        proposalEnvelope: proposal,
        responseEnvelope: response,
        proposerDidDocument: b.artifacts.didDocument,
        responderDidDocument: a.artifacts.didDocument,
      }),
    ).rejects.toThrow(/does not\s+match|does not match/)
  })

  // Issue #2 — agreement provenance survives into the co-signed file and is
  // covered by both signatures.
  it('carries originTensionId into the materialized file under both signatures', async () => {
    const tension = await createTension({
      from: b.artifacts.did,
      to: a.artifacts.did,
      body: { conditions: 'Retros run over.', effect: 'Tensions leak into governance.' },
      signer: b.signer,
      id: 'tension-origin-1',
    })
    const agreement = {
      ...exampleAgreement([a.artifacts.did, b.artifacts.did]),
      originTensionId: 'tension-origin-1',
    }
    const proposal = await createProposal({
      from: a.artifacts.did,
      to: b.artifacts.did,
      body: {
        type: 'agreement',
        title: 'Retro cadence',
        body: 'Final.',
        stage: 'final',
        agreement,
      },
      signer: a.signer,
      tensionAntecedent: { envelope: tension, senderDidDocument: b.artifacts.didDocument },
      now: new Date('2026-06-09T12:00:00.000Z'),
    })
    const response = await createProposalResponse({
      from: b.artifacts.did,
      to: a.artifacts.did,
      body: { decision: 'accept' },
      refs: { proposalId: proposal.id },
      subjectEnvelope: proposal,
      subjectSenderDidDocument: a.artifacts.didDocument,
      signer: b.signer,
      now: new Date('2026-06-09T12:05:00.000Z'),
    })
    const materialized = await materializeAgreement({
      proposalEnvelope: proposal,
      responseEnvelope: response,
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
    expect(materialized.agreement.originTensionId).toBe('tension-origin-1')
    expect(materialized.yamlText).toContain('originTensionId: tension-origin-1')
    // The link is under signature: mutating it in the file breaks standalone verify.
    const parsed = parseDocument(materialized.yamlText).toJS() as FlywayAgreement
    const mutated = { ...parsed, originTensionId: 'tension-forged-9' }
    const sig = must(must(parsed.signatures)[0])
    const ok = await verifyAgreementSignature(
      mutated,
      {
        verificationKeyId: must(sig.verificationKeyId),
        algorithm: 'EdDSA',
        canonicalization: 'flyway-jcs-v1',
        domain: 'flyway-v1:agreement',
        signature: sig.signature,
      },
      sig.participant === a.artifacts.did ? a.artifacts.didDocument : b.artifacts.didDocument,
    )
    expect(ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────
// writeAgreementFile
// ────────────────────────────────────────────────────────────────────────

describe('writeAgreementFile', () => {
  let dir: string
  let materialized: MaterializedAgreement

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'flyway-materialize-'))
    const { proposal, response } = await consentClose()
    materialized = await materializeAgreement({
      proposalEnvelope: proposal,
      responseEnvelope: response,
      proposerDidDocument: a.artifacts.didDocument,
      responderDidDocument: b.artifacts.didDocument,
    })
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates flyway/agreements/<id>.yaml with the exact materialized bytes', () => {
    const { path, created } = writeAgreementFile(dir, materialized)
    expect(created).toBe(true)
    expect(path).toBe(agreementFilePath(dir, materialized.agreement.id))
    expect(readFileSync(path, 'utf-8')).toBe(materialized.yamlText)
  })

  it('re-writing identical bytes is a no-op', () => {
    const { created } = writeAgreementFile(dir, materialized)
    expect(created).toBe(false)
  })

  it('refuses to overwrite with different content', () => {
    const path = agreementFilePath(dir, materialized.agreement.id)
    writeFileSync(path, materialized.yamlText + '# drift\n')
    expect(() => writeAgreementFile(dir, materialized)).toThrow(/refusing to overwrite/)
    // Restore for any later assertions.
    writeFileSync(path, materialized.yamlText)
  })

  it('agreementFilePath rejects traversal-shaped ids', () => {
    expect(() => agreementFilePath(dir, '../escape')).toThrow(/must match/)
  })
})

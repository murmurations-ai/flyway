/**
 * flyway_respond — reply to an incoming tension or proposal.
 *
 * v0.1 wires the *tension-response* path only. The four valid tension
 * decisions (S3 §IV.1.2 / IV.1.7) are:
 *
 *   - acknowledge: agree this is a driver worth shared attention.
 *   - dispute:     disagree this is a driver, with reason.
 *   - dissolve:    on investigation, this is not a real driver.
 *   - transfer:    this belongs to a different domain or peer
 *                  (must set transferTo to a DID).
 *
 * Silence is never a valid response, and exit/dissolve are the *end* of
 * a process, not substitutes for one.
 *
 * Proposal responses (accept / object / exit) share the envelope plumbing
 * but layer on different invariants and will be added when flyway_propose
 * is wired.
 */

import type { DidDocument } from './init.js'
import {
  type BuildSignedSignalInput,
  type SignalRefs,
  type SignedSignalEnvelope,
  buildSignedSignal,
  verifySignedSignal,
} from './signal.js'
import type { Signer } from './signing.js'

export const TENSION_DECISIONS = [
  'acknowledge',
  'dispute',
  'dissolve',
  'transfer',
] as const

export type TensionDecision = (typeof TENSION_DECISIONS)[number]

export const PROPOSAL_DECISIONS = ['accept', 'object', 'exit'] as const
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number]

/**
 * Decisions that require an explanatory reason. Acknowledge is the
 * only tension decision where silence-on-reasoning is acceptable — the
 * sender already supplied conditions and effect; agreement needs no
 * further justification. Disagreement, dissolution, or transfer all
 * demand a reason the original sender can engage with.
 */
const DECISIONS_REQUIRING_REASON: ReadonlySet<TensionDecision> = new Set([
  'dispute',
  'dissolve',
  'transfer',
])

export interface TensionResponseBody {
  /** S3 tension response decision. */
  readonly decision: TensionDecision
  /**
   * Rationale for the decision. Required for dispute / dissolve /
   * transfer; optional for acknowledge.
   */
  readonly reason?: string
  /**
   * DID of the role or peer the tension is being transferred to. Only
   * valid when decision === 'transfer'.
   */
  readonly transferTo?: string
}

/** Refs required on a tension response — tensionId is load-bearing. */
export type TensionResponseRefs = SignalRefs & { readonly tensionId: string }

export interface CreateTensionResponseInput {
  /** Responder DID — must match signer.verificationKeyId modulo fragment. */
  readonly from: string
  /** Recipient DID — the original tension's sender. */
  readonly to: string
  /** The response itself. */
  readonly body: TensionResponseBody
  /**
   * Required refs. `tensionId` (and `inReplyTo`) must be the id of the
   * prior tension; a response with no subject is not a response.
   */
  readonly refs: TensionResponseRefs
  /**
   * The tension this is responding to (as cached in the responder's
   * inbox). Required: per ADR-0009 we never sign a response over an
   * unverified antecedent artifact.
   */
  readonly subjectEnvelope: SignedSignalEnvelope
  /**
   * The subject's sender DID document, loaded from the responder's
   * recognition-time cache (`flyway/peers/<segments>/did.json`). MUST
   * be the cached copy, not a fresh read from the peer's repo —
   * otherwise an attacker who can control that path can supply a
   * matching public key for a tension they fabricated.
   */
  readonly subjectSenderDidDocument: DidDocument
  /** Signer for the responding Source. */
  readonly signer: Signer
  /** Override id generation. */
  readonly id?: string
  /** Override "now" for testing / determinism. */
  readonly now?: Date
}

/**
 * Build a signed response envelope to a prior tension.
 *
 * Validates:
 *  - decision is one of the four tension decisions
 *  - reason is non-empty when the decision requires it
 *  - transferTo is provided iff decision === 'transfer'
 *  - refs.tensionId is present and matches subjectEnvelope.id
 *  - the subject envelope is a tension
 *  - the subject envelope's `from` matches the response's `to`
 *  - **the subject envelope's signature verifies against the cached
 *    sender DID document** (ADR-0009 antecedent verification — we
 *    never launder a broken signature into our signed reply chain).
 */
export async function createTensionResponse(
  input: CreateTensionResponseInput,
): Promise<SignedSignalEnvelope> {
  const { body, refs, subjectEnvelope, subjectSenderDidDocument } = input
  if (!TENSION_DECISIONS.includes(body.decision)) {
    throw new Error(
      `createTensionResponse: decision must be one of ${TENSION_DECISIONS.join(', ')} ` +
        `(got: ${String(body.decision)})`,
    )
  }
  if (DECISIONS_REQUIRING_REASON.has(body.decision)) {
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      throw new Error(
        `createTensionResponse: decision '${body.decision}' requires a non-empty reason`,
      )
    }
  }
  if (body.decision === 'transfer') {
    if (typeof body.transferTo !== 'string' || body.transferTo.trim() === '') {
      throw new Error(
        "createTensionResponse: decision 'transfer' requires a non-empty transferTo DID",
      )
    }
  } else if (body.transferTo !== undefined) {
    throw new Error(
      `createTensionResponse: transferTo is only valid when decision === 'transfer' ` +
        `(got decision='${body.decision}')`,
    )
  }
  if (typeof refs.tensionId !== 'string' || refs.tensionId.trim() === '') {
    throw new Error(
      'createTensionResponse: refs.tensionId is required — a response must point at a subject',
    )
  }

  // Antecedent verification (ADR-0009). The subject envelope must
  // resolve to a real tension from the peer we're replying to and must
  // verify under that peer's recognition-time-cached key. Each check
  // is its own error path so failures are diagnosable.
  if (subjectEnvelope.kind !== 'tension') {
    throw new Error(
      `createTensionResponse: subjectEnvelope.kind must be 'tension' ` +
        `(got: ${subjectEnvelope.kind})`,
    )
  }
  if (subjectEnvelope.id !== refs.tensionId) {
    throw new Error(
      `createTensionResponse: refs.tensionId (${refs.tensionId}) does not match ` +
        `subjectEnvelope.id (${subjectEnvelope.id})`,
    )
  }
  if (subjectEnvelope.from !== input.to) {
    throw new Error(
      `createTensionResponse: subjectEnvelope.from (${subjectEnvelope.from}) does not ` +
        `match response 'to' (${input.to}) — responses go back to the subject's sender`,
    )
  }
  if (subjectSenderDidDocument.id !== subjectEnvelope.from) {
    throw new Error(
      `createTensionResponse: subjectSenderDidDocument.id (${subjectSenderDidDocument.id}) ` +
        `does not match subjectEnvelope.from (${subjectEnvelope.from})`,
    )
  }
  const subjectOk = await verifySignedSignal(subjectEnvelope, subjectSenderDidDocument)
  if (!subjectOk) {
    throw new Error(
      `createTensionResponse: subjectEnvelope signature does not verify against the ` +
        `cached sender DID document. Refusing to respond to a tampered or stale tension.`,
    )
  }

  const normalizedBody: TensionResponseBody = {
    decision: body.decision,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.transferTo !== undefined ? { transferTo: body.transferTo } : {}),
  }
  const normalizedRefs: SignalRefs = {
    tensionId: refs.tensionId,
    // Default inReplyTo to the tension id when the caller didn't supply one
    // explicitly — every tension response is in reply to its subject.
    inReplyTo: refs.inReplyTo ?? refs.tensionId,
    ...(refs.proposalId !== undefined ? { proposalId: refs.proposalId } : {}),
  }

  const buildInput: BuildSignedSignalInput = {
    from: input.from,
    to: input.to,
    kind: 'respond',
    body: normalizedBody,
    signer: input.signer,
    refs: normalizedRefs,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  }
  return buildSignedSignal(buildInput)
}

// ────────────────────────────────────────────────────────────────────────
// Proposal responses (S+5 / S3 §IV.1.5 + §IV.1.7)
// ────────────────────────────────────────────────────────────────────────

/**
 * Decisions in a proposal-consent round (S3 §IV.1.5):
 *   - accept:  consent to the proposal as written.
 *   - object:  raise a concern that blocks consent; proposal stays open
 *              for refinement.
 *   - exit:    withdraw from the agreement-forming process after a
 *              good-faith attempt to reach consent has been exhausted.
 *
 * `concernsToRecord` (Issue #3, #15) carries S3 §IV.1.5 Step 9 concerns —
 * things the responder does NOT object on but wants noted for the next
 * review. Valid on `accept` (chiefly) and on `object` (where they're
 * distinct from the blocking concern in `reason`).
 */
export interface ProposalResponseBody {
  readonly decision: ProposalDecision
  /** Required for object/exit; optional for accept. */
  readonly reason?: string
  /** S3 §IV.1.5 Step 9 concerns to record. (Issues #3, #15) */
  readonly concernsToRecord?: readonly string[]
}

export type ProposalResponseRefs = SignalRefs & { readonly proposalId: string }

export interface CreateProposalResponseInput {
  readonly from: string
  readonly to: string
  readonly body: ProposalResponseBody
  readonly refs: ProposalResponseRefs
  /**
   * The proposal this is responding to. Required: per ADR-0009 we never
   * sign a response over an unverified antecedent artifact.
   */
  readonly subjectEnvelope: SignedSignalEnvelope
  /**
   * The proposal sender's DID document, loaded from the responder's
   * recognition-time cache (`flyway/peers/<segments>/did.json`). MUST be
   * the cached copy.
   */
  readonly subjectSenderDidDocument: DidDocument
  readonly signer: Signer
  readonly id?: string
  readonly now?: Date
}

const PROPOSAL_DECISIONS_REQUIRING_REASON: ReadonlySet<ProposalDecision> = new Set([
  'object',
  'exit',
])

/**
 * Build a signed response envelope to a prior proposal.
 *
 * Validates:
 *  - decision is one of the three proposal decisions
 *  - reason is non-empty when the decision requires it (object/exit)
 *  - concernsToRecord (if present) is a non-empty array of non-empty strings
 *  - refs.proposalId is present and matches subjectEnvelope.id
 *  - the subject envelope is a proposal
 *  - the subject envelope's `from` matches the response's `to`
 *  - **the subject envelope's signature verifies under the cached sender
 *    DID document** (ADR-0009 antecedent verification).
 */
export async function createProposalResponse(
  input: CreateProposalResponseInput,
): Promise<SignedSignalEnvelope> {
  const { body, refs, subjectEnvelope, subjectSenderDidDocument } = input

  if (!PROPOSAL_DECISIONS.includes(body.decision)) {
    throw new Error(
      `createProposalResponse: decision must be one of ${PROPOSAL_DECISIONS.join(', ')} ` +
        `(got: ${String(body.decision)})`,
    )
  }
  if (PROPOSAL_DECISIONS_REQUIRING_REASON.has(body.decision)) {
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      throw new Error(
        `createProposalResponse: decision '${body.decision}' requires a non-empty reason`,
      )
    }
  }
  if (body.concernsToRecord !== undefined) {
    if (!Array.isArray(body.concernsToRecord) || body.concernsToRecord.length === 0) {
      throw new Error(
        'createProposalResponse: concernsToRecord must be a non-empty array of strings when present',
      )
    }
    for (const [i, c] of body.concernsToRecord.entries()) {
      if (typeof c !== 'string' || c.trim() === '') {
        throw new Error(
          `createProposalResponse: concernsToRecord[${i}] must be a non-empty string`,
        )
      }
    }
  }
  if (typeof refs.proposalId !== 'string' || refs.proposalId.trim() === '') {
    throw new Error(
      'createProposalResponse: refs.proposalId is required — a response must point at a subject',
    )
  }

  // Antecedent verification (ADR-0009).
  if (subjectEnvelope.kind !== 'proposal') {
    throw new Error(
      `createProposalResponse: subjectEnvelope.kind must be 'proposal' ` +
        `(got: ${subjectEnvelope.kind})`,
    )
  }
  if (subjectEnvelope.id !== refs.proposalId) {
    throw new Error(
      `createProposalResponse: refs.proposalId (${refs.proposalId}) does not match ` +
        `subjectEnvelope.id (${subjectEnvelope.id})`,
    )
  }
  if (subjectEnvelope.from !== input.to) {
    throw new Error(
      `createProposalResponse: subjectEnvelope.from (${subjectEnvelope.from}) does not ` +
        `match response 'to' (${input.to}) — responses go back to the subject's sender`,
    )
  }
  if (subjectSenderDidDocument.id !== subjectEnvelope.from) {
    throw new Error(
      `createProposalResponse: subjectSenderDidDocument.id (${subjectSenderDidDocument.id}) ` +
        `does not match subjectEnvelope.from (${subjectEnvelope.from})`,
    )
  }
  const subjectOk = await verifySignedSignal(subjectEnvelope, subjectSenderDidDocument)
  if (!subjectOk) {
    throw new Error(
      'createProposalResponse: subjectEnvelope signature does not verify against the ' +
        'cached sender DID document. Refusing to respond to a tampered or stale proposal.',
    )
  }

  const normalizedBody: ProposalResponseBody = {
    decision: body.decision,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.concernsToRecord !== undefined
      ? { concernsToRecord: body.concernsToRecord }
      : {}),
  }
  const normalizedRefs: SignalRefs = {
    proposalId: refs.proposalId,
    inReplyTo: refs.inReplyTo ?? refs.proposalId,
    ...(refs.tensionId !== undefined ? { tensionId: refs.tensionId } : {}),
  }

  const buildInput: BuildSignedSignalInput = {
    from: input.from,
    to: input.to,
    kind: 'respond',
    body: normalizedBody,
    signer: input.signer,
    refs: normalizedRefs,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  }
  return buildSignedSignal(buildInput)
}

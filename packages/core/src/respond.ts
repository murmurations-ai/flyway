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

import {
  type BuildSignedSignalInput,
  type SignalRefs,
  type SignedSignalEnvelope,
  buildSignedSignal,
} from './signal.js'
import type { Signer } from './signing.js'

export const TENSION_DECISIONS = [
  'acknowledge',
  'dispute',
  'dissolve',
  'transfer',
] as const

export type TensionDecision = (typeof TENSION_DECISIONS)[number]

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
  readonly refs: SignalRefs & { readonly tensionId: string }
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
 *  - refs.tensionId is present (a response with no subject is not a response)
 */
export async function createTensionResponse(
  input: CreateTensionResponseInput,
): Promise<SignedSignalEnvelope> {
  const { body, refs } = input
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

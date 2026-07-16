/**
 * flyway_tension — surface a tension to a recognized peer.
 *
 * S3 §IV.1.2 (Navigate via Tension) + §IV.1.3 (Describe Organizational
 * Drivers). A tension is a pre-proposal observation: a situation a Source
 * notices that might be worth shared attention, before any action is
 * proposed. The peer responds via flyway_respond with
 * acknowledge / dispute / dissolve / transfer. An acknowledged tension
 * may later be promoted to a proposal whose `refs.tensionId` points
 * back here.
 *
 * This module produces the signed envelope. Filesystem placement
 * (own outbox, recipient inbox) and recognized-peer lookup live in the
 * CLI / adapter layer, mirroring the recognize module split.
 */

import {
  type BuildSignedSignalInput,
  type SignalRefs,
  type SignedSignalEnvelope,
  buildSignedSignal,
} from './signal.js'
import type { Signer } from './signing.js'

export interface TensionBody {
  /** What is happening — concrete, specific, objective. No evaluative language. */
  readonly conditions: string
  /** Current or anticipated effect these conditions produce. */
  readonly effect: string
  /** Why this is relevant to the shared context. Optional when obvious from conditions+effect. */
  readonly relevance?: string
  /** Optional: DID or role identifier the sender thinks should hold this tension. */
  readonly proposedOwner?: string
}

export interface CreateTensionInput {
  /** Sender DID — must match signer.verificationKeyId modulo fragment. */
  readonly from: string
  /** Recipient (peer) DID. */
  readonly to: string
  /** The tension itself. */
  readonly body: TensionBody
  /** Signer for the sending Source. */
  readonly signer: Signer
  /** Optional cross-signal references. */
  readonly refs?: SignalRefs
  /** Override id generation. */
  readonly id?: string
  /** Override "now" for testing / determinism. */
  readonly now?: Date
}

/**
 * Build a signed tension envelope ready to be written to outbox/inbox.
 * Validates that conditions and effect are non-empty strings — a tension
 * with no observable conditions or effect is not a tension.
 */
export async function createTension(input: CreateTensionInput): Promise<SignedSignalEnvelope> {
  const { body } = input
  if (typeof body.conditions !== 'string' || body.conditions.trim() === '') {
    throw new Error('createTension: body.conditions must be a non-empty string')
  }
  if (typeof body.effect !== 'string' || body.effect.trim() === '') {
    throw new Error('createTension: body.effect must be a non-empty string')
  }
  const normalizedBody: TensionBody = {
    conditions: body.conditions,
    effect: body.effect,
    ...(body.relevance !== undefined ? { relevance: body.relevance } : {}),
    ...(body.proposedOwner !== undefined ? { proposedOwner: body.proposedOwner } : {}),
  }
  const buildInput: BuildSignedSignalInput = {
    from: input.from,
    to: input.to,
    kind: 'tension',
    body: normalizedBody,
    signer: input.signer,
    ...(input.refs !== undefined ? { refs: input.refs } : {}),
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  }
  return buildSignedSignal(buildInput)
}

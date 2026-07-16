/**
 * flyway_exit — leave a peer relationship, project, or syndicate cleanly.
 *
 * S3 §IV.7.1 (Contract for Successful Collaboration) treats a clear exit
 * protocol as a property of any healthy agreement. In flyway, exit is
 * stronger than that: it is *always valid* and no peer can prevent it.
 * Exit is the structural guarantee that collaboration never becomes
 * capture — a Source that wants out is out.
 *
 * Exit is therefore unilateral: unlike a proposal response, it carries no
 * antecedent-consent obligation. It is a signed *notice*, delivered to the
 * peer like any other signal, recorded in both repos.
 *
 * What exit is NOT:
 *   - Not unrecognition. Exiting a collaboration ends joint commitments;
 *     it does not retract the identity attestation made at recognition.
 *     A Source may exit every shared project and still recognize the peer.
 *     (Use flyway_unrecognize to withdraw recognition.)
 *   - Not a mutation of co-signed artifacts. A co-signed
 *     flyway/agreements/<id>.yaml is immutable — its signatures cover its
 *     bytes. Exit is a *superseding* record; the agreement's effective
 *     lifecycle state (closed) is read from the presence of an exit that
 *     targets it, not by rewriting the signed file.
 *
 * This module produces the signed envelope. Filesystem placement (own
 * outbox, recipient inbox) and the recognized-peer trust gate live in the
 * CLI / adapter layer, mirroring the tension module split.
 */

import {
  type BuildSignedSignalInput,
  type SignalRefs,
  type SignedSignalEnvelope,
  buildSignedSignal,
} from './signal.js'
import type { Signer } from './signing.js'

export const EXIT_TARGET_TYPES = ['peer', 'project', 'syndicate'] as const
export type ExitTargetType = (typeof EXIT_TARGET_TYPES)[number]

export interface ExitBody {
  /**
   * What is being exited. For targetType='peer' this is the peer's DID
   * (and must equal the envelope recipient). For 'project' / 'syndicate'
   * it is the id of that project or syndicate.
   */
  readonly target: string
  /**
   * peer = exit the entire relationship with this peer; every agreement
   * with them closes. project = exit one project. syndicate = exit a
   * syndicate.
   */
  readonly targetType: ExitTargetType
  /** Optional reason, shared with the peer. Omitted when absent. */
  readonly reason?: string
}

export interface CreateExitInput {
  /** Sender DID — must match signer.verificationKeyId modulo fragment. */
  readonly from: string
  /** Recipient (peer) DID — the peer being notified of the exit. */
  readonly to: string
  /** The exit notice itself. */
  readonly body: ExitBody
  /** Signer for the exiting Source. */
  readonly signer: Signer
  /**
   * Optional cross-signal references — e.g. refs.proposalId / a future
   * agreementId to point at the specific agreement being exited.
   */
  readonly refs?: SignalRefs
  /** Override id generation. */
  readonly id?: string
  /** Override "now" for testing / determinism. */
  readonly now?: Date
}

/**
 * Build a signed exit envelope ready to be written to outbox/inbox.
 *
 * Validates:
 *  - targetType is one of peer / project / syndicate
 *  - target is a non-empty string
 *  - for targetType='peer', target equals the recipient (`to`) — you
 *    cannot send peer-exit-of-X as a notice to peer Y
 *  - reason, when present, is a non-empty string
 *
 * No antecedent verification: exit is unilateral and always valid, so it
 * does not sign over a prior artifact the way a response does.
 */
export async function createExit(input: CreateExitInput): Promise<SignedSignalEnvelope> {
  const { body } = input

  if (!EXIT_TARGET_TYPES.includes(body.targetType)) {
    throw new Error(
      `createExit: targetType must be one of ${EXIT_TARGET_TYPES.join(', ')} ` +
        `(got: ${body.targetType})`,
    )
  }
  if (typeof body.target !== 'string' || body.target.trim() === '') {
    throw new Error('createExit: body.target must be a non-empty string')
  }
  if (body.targetType === 'peer' && body.target !== input.to) {
    throw new Error(
      `createExit: for targetType='peer', body.target (${body.target}) must equal the ` +
        `recipient 'to' (${input.to}) — a peer exit is a notice to the peer being exited`,
    )
  }
  if (body.reason !== undefined) {
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      throw new Error('createExit: body.reason must be a non-empty string when present')
    }
  }

  const normalizedBody: ExitBody = {
    target: body.target,
    targetType: body.targetType,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
  }
  const buildInput: BuildSignedSignalInput = {
    from: input.from,
    to: input.to,
    kind: 'exit',
    body: normalizedBody,
    signer: input.signer,
    ...(input.refs !== undefined ? { refs: input.refs } : {}),
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  }
  return buildSignedSignal(buildInput)
}

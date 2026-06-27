/**
 * Signal transport (v0.2a, part 2) — the pluggable seam ADR-0008 reserved,
 * now an explicit interface. A transport moves a signed envelope from a
 * sender to a recipient's inbox; it does not interpret, re-sign, or reorder
 * the bytes. The receiver (`flyway_check`) stays transport-agnostic.
 *
 * Invariants every transport must hold (see
 * docs/architecture/remote-transports-v0.2.md §2):
 *   1. Outbox-first is the SENDER's job, not the transport's. `sendSignal`
 *      writes the sender's outbox before invoking any transport, so the act
 *      of sending is durable even if delivery fails or returns
 *      `delivered: false`.
 *   2. Idempotent on (from, id) — re-delivering identical bytes is a no-op;
 *      differing bytes at the same (from, id) is refused. local-fs gets this
 *      from `writeSignalToInbox`'s wx + signature-compare guard.
 *   3. Bytes are moved verbatim; the signature must verify on the far side.
 *
 * v0.2a ships exactly one transport (`localFsTransport`). github-pr and
 * url-webhook are specified in the v0.2 transport doc and drop in here
 * without touching the senders — which is the whole point of this seam.
 */

import {
  type SignedSignalEnvelope,
  writeSignalToInbox,
  writeSignalToOutbox,
} from './signal.js'

/** Where a signal is being delivered — enough for any transport to act. */
export interface DeliveryTarget {
  /** Recipient DID (did:web:host:owner:repo). */
  readonly toDid: string
  /** local-fs: absolute path to the recipient's repo working tree. */
  readonly localRepoPath?: string
  /** github-pr (reserved): the recipient repo URL. */
  readonly repoUrl?: string
  /** url-webhook (reserved): the recipient's signed-envelope endpoint. */
  readonly webhookUrl?: string
}

export interface DeliveryReceipt {
  readonly transport: 'local-fs' | 'github-pr' | 'url-webhook'
  /** false = recorded in the sender's outbox but not yet delivered. */
  readonly delivered: boolean
  /** RFC 3339 delivery timestamp (wall-clock; not signed). */
  readonly at: string
  /** Transport-specific handle: inbox path, PR url, commit sha, or 2xx location. */
  readonly ref?: string
  /** Human-readable status. */
  readonly detail?: string
}

export type SignalTransport = (
  envelope: SignedSignalEnvelope,
  target: DeliveryTarget,
) => Promise<DeliveryReceipt>

/**
 * The default transport: write the envelope straight into the recipient's
 * `flyway/inbox/<…>/<id>.yaml`. Requires `target.localRepoPath`. Idempotency
 * and the path computation live in `writeSignalToInbox`.
 */
export const localFsTransport: SignalTransport = (envelope, target) => {
  // writeSignalToInbox is synchronous and can throw (EACCES/ENOSPC, or a
  // differing-bytes collision). Wrap everything so the function honours its
  // Promise contract — it rejects, never throws synchronously.
  try {
    if (!target.localRepoPath) {
      return Promise.reject(
        new Error(
          'localFsTransport: target.localRepoPath is required (the recipient repo working tree)',
        ),
      )
    }
    const { path, created } = writeSignalToInbox(target.localRepoPath, envelope)
    return Promise.resolve({
      transport: 'local-fs',
      delivered: true,
      at: new Date().toISOString(), // delivery time is a transport fact, not the signed sentAt
      ref: path,
      detail: created ? 'written to inbox' : 'already present (idempotent no-op)',
    })
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
}

export interface SendSignalInput {
  /** Sender repo working tree (for the outbox record). */
  readonly cwd: string
  readonly signal: SignedSignalEnvelope
  readonly target: DeliveryTarget
  /** Defaults to localFsTransport. */
  readonly transport?: SignalTransport
}

export interface SendSignalResult {
  /** Path of the sender's durable outbox record. */
  readonly outboxPath: string
  readonly receipt: DeliveryReceipt
}

/**
 * Send a signed signal: write the sender's outbox FIRST (durable record),
 * then deliver via the chosen transport. If the transport throws, the
 * outbox record still stands and the throw propagates — the caller can
 * retry by re-running with the same envelope (idempotent on (from, id)).
 */
export async function sendSignal(input: SendSignalInput): Promise<SendSignalResult> {
  const transport = input.transport ?? localFsTransport
  const outbox = writeSignalToOutbox(input.cwd, input.signal)
  const receipt = await transport(input.signal, input.target)
  return { outboxPath: outbox.path, receipt }
}

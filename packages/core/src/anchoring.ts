/**
 * Anchor interface — optional, per ADR-0007. No implementation ships in
 * v0.1; the interface lands now so future Anchor implementations (e.g.
 * @murmurations-ai/flyway-cardano) drop in without changing
 * artifact-producing code.
 *
 * An Anchor writes a hash of an artifact to an external ledger (or other
 * append-only store) and returns a receipt that a third party can later
 * verify. Anchoring is additional evidence; absence of an anchor is not
 * an error, and the GitHub repo remains the system-of-record.
 */

export interface AnchorReceipt {
  /** Matches the Anchor.id that produced this receipt. */
  readonly anchor: string
  /** Network identifier (e.g. 'cardano-mainnet', 'cardano-preprod', 'ipfs'). */
  readonly network: string
  /** Anchor-specific reference (tx hash, content identifier, …). */
  readonly ref: string
  /** RFC 3339 timestamp at which the anchor was written. */
  readonly anchoredAt: string
  /** Optional block height (or analogous depth metric) at write time. */
  readonly blockHeight?: number
  /** Anchor-specific metadata (slot, address, derivation path, etc.). */
  readonly meta?: Record<string, string>
}

export interface Anchor {
  /** Stable identity label (e.g. 'cardano-mainnet'). */
  readonly id: string

  /**
   * Write a hash (typically of canonical-bytes-of-an-artifact) to the
   * anchor's external store. refId is a flyway-side identifier the
   * caller may use to correlate (e.g. an agreement id).
   */
  anchor(hash: Uint8Array, refId: string): Promise<AnchorReceipt>

  /**
   * Verify that the given receipt corresponds to the given hash on the
   * external store. Verifiers SHOULD treat anchor failures as "no
   * evidence of anchoring" rather than as a refutation of the artifact.
   */
  verify(receipt: AnchorReceipt, hash: Uint8Array): Promise<boolean>
}

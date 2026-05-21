/**
 * flyway_recognize — unilateral, signed recognition of a peer murmuration.
 *
 * Recognition is one Source saying "I have verified this peer's identity
 * and am willing to engage with them under flyway." It is a unilateral act
 * — there is no "mutual" recognition envelope; mutual recognition means
 * both Sources independently produce their own signed entry.
 *
 * What gets signed: the recognition entry minus the signature field, under
 * the DOMAIN_RECOGNITION tag. The signing key is the recognizer's flyway
 * verification key. The peer's identity is bound by including a fingerprint
 * of their entity statement at the time of recognition — if the peer's
 * identity later changes, this entry can be detected as stale.
 *
 * This module produces the artifact. Persistence (writing to peers.yaml,
 * caching the peer's DID document and entity statement) lives in
 * flyway-cli or in adapter code, not here.
 */

import { createHash } from 'node:crypto'
import type { DidDocument, PublicKeyJwk, SignedEntityStatement } from './init.js'
import {
  DOMAIN_ENTITY_STATEMENT,
  DOMAIN_RECOGNITION,
  DOMAIN_UNRECOGNITION,
  type SignatureEnvelope,
  type Signer,
  canonicalize,
  signArtifactInline,
  verifyInlineSignedArtifact,
} from './signing.js'

export interface RecognitionEntry {
  readonly did: string
  readonly sourceName: string
  readonly mode: string
  /** The peer's verification key id at the time of recognition (e.g. did:web:...#key-1). */
  readonly peerVerificationKeyId: string
  /** The peer's public key (JWK form) at the time of recognition. Inline so verifying the recognition entry's binding to a specific key does not require re-fetching the peer's DID document. */
  readonly peerPublicKey: PublicKeyJwk
  /**
   * sha256 of the canonical bytes of the peer's signed entity statement
   * at the time of recognition. base64url. Lets us detect later identity
   * drift without re-fetching.
   */
  readonly entityStatementFingerprint: string
  /** RFC 3339 timestamp at which the recognizing Source made this entry. */
  readonly recognizedAt: string
  /** DID of the recognizing Source (matches signature.verificationKeyId minus the fragment). */
  readonly recognizedBy: string
  /** Optional human-readable rationale. */
  readonly note?: string
}

export type SignedRecognitionEntry = RecognitionEntry & {
  readonly signature: SignatureEnvelope
}

export interface RecognizePeerInput {
  /** The peer's DID document (as fetched). */
  readonly peerDidDocument: DidDocument
  /** The peer's signed entity statement (as fetched). */
  readonly peerEntityStatement: SignedEntityStatement
  /** The recognizing Source's DID. Must match signer.verificationKeyId modulo fragment. */
  readonly recognizedByDid: string
  /** A signer for the recognizing Source. */
  readonly signer: Signer
  /** Optional human note attached to this recognition. */
  readonly note?: string
  /** Override "now" for testing/determinism. */
  readonly now?: Date
}

export interface RecognizePeerOutput {
  readonly entry: SignedRecognitionEntry
  /** True iff the peer's entity statement verified against the peer's DID document. */
  readonly peerSignatureValid: boolean
}

export async function recognizePeer(input: RecognizePeerInput): Promise<RecognizePeerOutput> {
  // 1. Verify the peer's identity signature. If it doesn't verify, we
  //    refuse to recognize — we never sign an attestation to an
  //    unverifiable peer.
  const peerSignatureValid = await verifyInlineSignedArtifact(
    DOMAIN_ENTITY_STATEMENT,
    input.peerEntityStatement,
    input.peerDidDocument,
  )
  if (!peerSignatureValid) {
    throw new Error(
      `recognizePeer: peer entity statement signature does not verify against peer DID document ` +
        `(${input.peerEntityStatement.did}). Refusing to recognize an unverifiable peer.`,
    )
  }

  // 2. DID consistency check across peer's own artifacts.
  if (input.peerDidDocument.id !== input.peerEntityStatement.did) {
    throw new Error(
      `recognizePeer: peer DID mismatch — did.json declares ${input.peerDidDocument.id} ` +
        `but entity-statement.json claims ${input.peerEntityStatement.did}.`,
    )
  }

  // 3. Refuse to recognize ourselves. Recognition is for peers.
  if (input.peerEntityStatement.did === input.recognizedByDid) {
    throw new Error(
      `recognizePeer: cannot recognize self (${input.recognizedByDid}). Recognition is for peers.`,
    )
  }

  // 4. Compute peer entity-statement fingerprint over its canonical bytes.
  const fingerprint = fingerprintEntityStatement(input.peerEntityStatement)

  // 5. Pull the peer's verification key inline. We bind it into the
  //    recognition entry so future drift (peer rotates keys) is detectable
  //    without re-fetching the peer's DID document.
  const peerMethod = input.peerDidDocument.verificationMethod.find(
    (m) => m.id === input.peerEntityStatement.verificationKeyId,
  )
  if (!peerMethod) {
    throw new Error(
      `recognizePeer: peer DID document has no verificationMethod with id ` +
        `${input.peerEntityStatement.verificationKeyId}.`,
    )
  }

  // 6. Build the unsigned entry.
  const now = input.now ?? new Date()
  const unsigned: RecognitionEntry = {
    did: input.peerEntityStatement.did,
    sourceName: input.peerEntityStatement.sourceName,
    mode: input.peerEntityStatement.mode,
    peerVerificationKeyId: peerMethod.id,
    peerPublicKey: peerMethod.publicKeyJwk,
    entityStatementFingerprint: fingerprint,
    recognizedAt: now.toISOString(),
    recognizedBy: input.recognizedByDid,
    ...(input.note !== undefined ? { note: input.note } : {}),
  }

  // 7. Sign the entry inline.
  const signed = await signArtifactInline(DOMAIN_RECOGNITION, unsigned, input.signer)

  return {
    entry: signed as SignedRecognitionEntry,
    peerSignatureValid,
  }
}

// ────────────────────────────────────────────────────────────────────────
// Unrecognition — the inverse of recognize. A Source unilaterally
// withdraws recognition of a peer. Produces a signed unrecognition record
// for audit; the peers.yaml entry is removed by the caller.
// ────────────────────────────────────────────────────────────────────────

export interface UnrecognitionRecord {
  readonly peer: string
  readonly unrecognizedAt: string
  readonly unrecognizedBy: string
  /** When the recognition being withdrawn was originally entered. Copied from the prior entry. */
  readonly priorRecognizedAt: string
  /** Optional human-readable rationale. */
  readonly reason?: string
}

export type SignedUnrecognitionRecord = UnrecognitionRecord & {
  readonly signature: SignatureEnvelope
}

export interface UnrecognizePeerInput {
  readonly priorEntry: SignedRecognitionEntry
  readonly unrecognizedByDid: string
  readonly signer: Signer
  readonly reason?: string
  readonly now?: Date
}

export async function unrecognizePeer(
  input: UnrecognizePeerInput,
): Promise<SignedUnrecognitionRecord> {
  if (input.priorEntry.recognizedBy !== input.unrecognizedByDid) {
    throw new Error(
      `unrecognizePeer: prior entry was recognized by ${input.priorEntry.recognizedBy} ` +
        `but unrecognize was attempted by ${input.unrecognizedByDid}. ` +
        `Only the Source who recognized may unrecognize.`,
    )
  }
  const now = input.now ?? new Date()
  const unsigned: UnrecognitionRecord = {
    peer: input.priorEntry.did,
    unrecognizedAt: now.toISOString(),
    unrecognizedBy: input.unrecognizedByDid,
    priorRecognizedAt: input.priorEntry.recognizedAt,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  }
  const signed = await signArtifactInline(DOMAIN_UNRECOGNITION, unsigned, input.signer)
  return signed as SignedUnrecognitionRecord
}

export async function verifyUnrecognitionRecord(
  record: SignedUnrecognitionRecord,
  unrecognizerDidDocument: DidDocument,
): Promise<boolean> {
  return verifyInlineSignedArtifact(DOMAIN_UNRECOGNITION, record, unrecognizerDidDocument)
}

/**
 * Verify a previously-recorded recognition entry against the recognizing
 * Source's DID document. Use this when reading peers.yaml to confirm each
 * entry is still signed by the Source whose repo it lives in.
 */
export async function verifyRecognitionEntry(
  entry: SignedRecognitionEntry,
  recognizerDidDocument: DidDocument,
): Promise<boolean> {
  return verifyInlineSignedArtifact(DOMAIN_RECOGNITION, entry, recognizerDidDocument)
}

export function fingerprintEntityStatement(
  signedStatement: SignedEntityStatement,
): string {
  const canonical = canonicalize(signedStatement)
  const hash = createHash('sha256').update(canonical).digest()
  return hash.toString('base64url')
}

/**
 * Compute the peer-cache subpath for a did:web DID, mirroring the GitHub
 * URL layout. E.g. did:web:github.com:foo:bar → 'github.com/foo/bar'.
 *
 * Throws on non-did:web DIDs; v0.1 only supports did:web.
 */
export function peerCachePathSegments(did: string): readonly string[] {
  const prefix = 'did:web:'
  if (!did.startsWith(prefix)) {
    throw new Error(`peerCachePathSegments: only did:web DIDs supported (got: ${did})`)
  }
  const tail = did.slice(prefix.length)
  const segments = tail.split(':').filter((s) => s.length > 0)
  if (segments.length < 2) {
    throw new Error(`peerCachePathSegments: did:web missing path components (got: ${did})`)
  }
  return segments
}

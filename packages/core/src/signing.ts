/**
 * Signing primitives for flyway artifacts.
 *
 * Per ADR-0007: signing is mandatory, with a local Ed25519 default; the
 * Signer interface is pluggable so future signers (Cardano hot key, HSM,
 * KMS) drop in without changing artifact-producing code.
 *
 * Three layered concerns:
 *   1. Canonicalization — deterministic byte representation of a JSON value
 *      (a minimal JCS-style scheme; sorted keys, no whitespace).
 *   2. Domain separation — every signed payload is prefixed with a domain
 *      tag so a flyway signature cannot be replayed as a non-flyway one
 *      (e.g. mistaken for a Cardano tx signature when keys are reused).
 *   3. Envelope — the Signer produces raw bytes; signArtifactInline wraps
 *      those bytes in a SignatureEnvelope carrying verification metadata.
 *
 * Signatures are attached inline to the artifact (the artifact gains a
 * `signature` field, in line with W3C VC / jws-2020 conventions). The
 * signature field is excluded from canonicalization to avoid the
 * chicken-and-egg of signing over a self-reference.
 */

import {
  createPrivateKey,
  createPublicKey,
  type JsonWebKey,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto'
import type { DidDocument, PublicKeyJwk } from './init.js'

// ────────────────────────────────────────────────────────────────────────
// Domain tags. Each artifact type that gets signed has a unique tag so
// signatures over one kind of artifact cannot be replayed against
// another. Tags include the protocol major version.
// ────────────────────────────────────────────────────────────────────────

export const DOMAIN_ENTITY_STATEMENT = 'flyway-v1:entity-statement'
export const DOMAIN_RECOGNITION = 'flyway-v1:recognition'
export const DOMAIN_UNRECOGNITION = 'flyway-v1:unrecognition'
export const DOMAIN_AGREEMENT = 'flyway-v1:agreement'
export const DOMAIN_PROPOSAL = 'flyway-v1:proposal'
export const DOMAIN_RESPOND = 'flyway-v1:respond'
export const DOMAIN_TENSION = 'flyway-v1:tension'
export const DOMAIN_EXIT = 'flyway-v1:exit'

// ────────────────────────────────────────────────────────────────────────
// Interfaces (the pluggable seam from ADR-0007). Implementations
// produce raw signature bytes; envelope construction lives in this module.
// ────────────────────────────────────────────────────────────────────────

export interface Signer {
  /** Stable identity label for the signer (e.g. 'local-ed25519:<did#fragment>'). */
  readonly id: string
  /** DID URL of the verification method this signer's key matches (e.g. 'did:web:…#key-1'). */
  readonly verificationKeyId: string
  /** Public key in JWK form. Embedded into the DID document elsewhere. */
  readonly publicKeyJwk: PublicKeyJwk
  /** Produce a raw signature over the given bytes. */
  sign(bytes: Uint8Array): Promise<Uint8Array>
}

export interface SignatureEnvelope {
  readonly verificationKeyId: string
  readonly algorithm: 'EdDSA'
  readonly canonicalization: 'flyway-jcs-v1'
  readonly domain: string
  readonly signature: string // base64url-encoded
}

// ────────────────────────────────────────────────────────────────────────
// Canonicalization. A minimal JCS-style scheme:
//   - Objects: keys sorted by UTF-16 code unit (JS default string compare)
//   - undefined values are dropped (treated as "not present")
//   - No insignificant whitespace
//   - Numbers via JSON.stringify (RFC 8259 compatible; flyway artifacts
//     contain no non-integer numbers today)
// ────────────────────────────────────────────────────────────────────────

export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: non-finite number')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = obj[k]
      if (v === undefined) continue
      parts.push(JSON.stringify(k) + ':' + canonicalize(v))
    }
    return '{' + parts.join(',') + '}'
  }
  throw new Error(`canonicalize: unsupported value of type ${typeof value}`)
}

// ────────────────────────────────────────────────────────────────────────
// Domain separation. Concatenates domain || NUL || canonical-json-bytes.
// The NUL byte is unambiguous because the domain tag contains only
// printable ASCII.
// ────────────────────────────────────────────────────────────────────────

export function domainSeparated(domain: string, canonicalJson: string): Uint8Array {
  if (domain.length === 0) throw new Error('domainSeparated: empty domain tag')
  if (domain.includes('\0')) throw new Error('domainSeparated: domain tag contains NUL')
  const enc = new TextEncoder()
  const a = enc.encode(domain)
  const b = enc.encode(canonicalJson)
  const out = new Uint8Array(a.length + 1 + b.length)
  out.set(a, 0)
  out[a.length] = 0
  out.set(b, a.length + 1)
  return out
}

// ────────────────────────────────────────────────────────────────────────
// base64url helpers — Buffer is the most portable Node primitive.
// ────────────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromBase64Url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'))
}

// ────────────────────────────────────────────────────────────────────────
// Local Ed25519 signer — the default for v0.1 and the reference
// implementation against which the Signer interface is tested.
// ────────────────────────────────────────────────────────────────────────

export interface LocalEd25519SignerOptions {
  readonly privateKeyPem: string
  readonly publicKeyJwk: PublicKeyJwk
  readonly verificationKeyId: string
}

export function localEd25519Signer(opts: LocalEd25519SignerOptions): Signer {
  const privateKey = createPrivateKey(opts.privateKeyPem)
  return {
    id: `local-ed25519:${opts.verificationKeyId}`,
    verificationKeyId: opts.verificationKeyId,
    publicKeyJwk: opts.publicKeyJwk,
    // eslint-disable-next-line @typescript-eslint/require-await -- Signer.sign interface returns a Promise
    sign: async (bytes: Uint8Array): Promise<Uint8Array> => {
      // For Ed25519, Node accepts a null algorithm — the algorithm is
      // implied by the key type, and the message is hashed inside the
      // EdDSA construction.
      const sig = nodeSign(null, bytes, privateKey)
      return new Uint8Array(sig)
    },
  }
}

// ────────────────────────────────────────────────────────────────────────
// Inline signature helpers — attach a signature field to an artifact,
// and verify a signed artifact against its DID document.
// ────────────────────────────────────────────────────────────────────────

export type SignedInline<T> = T & { readonly signature: SignatureEnvelope }

export async function signArtifactInline<T extends object>(
  domain: string,
  artifact: T,
  signer: Signer,
): Promise<SignedInline<T>> {
  const stripped = stripSignature(artifact)
  const canonical = canonicalize(stripped)
  const bytes = domainSeparated(domain, canonical)
  const sig = await signer.sign(bytes)
  const envelope: SignatureEnvelope = {
    verificationKeyId: signer.verificationKeyId,
    algorithm: 'EdDSA',
    canonicalization: 'flyway-jcs-v1',
    domain,
    signature: toBase64Url(sig),
  }
  return { ...(stripped as T), signature: envelope }
}

// eslint-disable-next-line @typescript-eslint/require-await -- async verification API; callers await this
export async function verifyInlineSignedArtifact(
  expectedDomain: string,
  signed: { signature?: SignatureEnvelope },
  didDocument: DidDocument,
): Promise<boolean> {
  const envelope = signed.signature
  if (!envelope) return false
  if (envelope.domain !== expectedDomain) return false
  // The algorithm/canonicalization/crv fields are typed as literals but arrive
  // from untrusted parsed data — these are defensive checks, not redundant.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- untrusted-envelope */
  if (envelope.algorithm !== 'EdDSA') return false
  if (envelope.canonicalization !== 'flyway-jcs-v1') return false

  const method = didDocument.verificationMethod.find((m) => m.id === envelope.verificationKeyId)
  if (!method) return false
  if (method.publicKeyJwk.crv !== 'Ed25519') return false
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  const stripped = stripSignature(signed)
  const canonical = canonicalize(stripped)
  const bytes = domainSeparated(expectedDomain, canonical)
  const sigBytes = fromBase64Url(envelope.signature)

  const publicKey = createPublicKey({
    key: method.publicKeyJwk as unknown as JsonWebKey,
    format: 'jwk',
  })
  return nodeVerify(null, bytes, publicKey, sigBytes)
}

function stripSignature<T extends object>(artifact: T): Omit<T, 'signature'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-omit strips signature
  const { signature: _omit, ...rest } = artifact as T & { signature?: unknown }
  return rest
}

// ────────────────────────────────────────────────────────────────────────
// Detached signature helpers — produce / verify a SignatureEnvelope that
// travels separately from the artifact it covers. Used when two parties
// must sign the *same* canonical bytes (e.g. co-signed agreements, where
// inline attachment would make the second signature cover the first).
// ────────────────────────────────────────────────────────────────────────

export async function signArtifactDetached(
  domain: string,
  artifact: object,
  signer: Signer,
): Promise<SignatureEnvelope> {
  const canonical = canonicalize(artifact)
  const bytes = domainSeparated(domain, canonical)
  const sig = await signer.sign(bytes)
  return {
    verificationKeyId: signer.verificationKeyId,
    algorithm: 'EdDSA',
    canonicalization: 'flyway-jcs-v1',
    domain,
    signature: toBase64Url(sig),
  }
}

// eslint-disable-next-line @typescript-eslint/require-await -- async verification API; callers await this
export async function verifyDetachedSignature(
  expectedDomain: string,
  artifact: object,
  envelope: SignatureEnvelope,
  didDocument: DidDocument,
): Promise<boolean> {
  if (envelope.domain !== expectedDomain) return false
  // Defensive checks over untrusted parsed envelope fields (typed as literals).
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- untrusted-envelope */
  if (envelope.algorithm !== 'EdDSA') return false
  if (envelope.canonicalization !== 'flyway-jcs-v1') return false

  const method = didDocument.verificationMethod.find((m) => m.id === envelope.verificationKeyId)
  if (!method) return false
  if (method.publicKeyJwk.crv !== 'Ed25519') return false
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  const canonical = canonicalize(artifact)
  const bytes = domainSeparated(expectedDomain, canonical)
  const sigBytes = fromBase64Url(envelope.signature)

  const publicKey = createPublicKey({
    key: method.publicKeyJwk as unknown as JsonWebKey,
    format: 'jwk',
  })
  return nodeVerify(null, bytes, publicKey, sigBytes)
}

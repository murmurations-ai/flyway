/**
 * Agreement materialization (S+5b) — turn an accepted final-stage
 * agreement proposal into the co-signed file at
 * flyway/agreements/<id>.yaml.
 *
 * "Co-signed" in flyway means byte-identity: each participant runs
 * materializeAgreement against the records they already hold (the final
 * proposal and the accept response) and writes a file whose bytes are
 * identical to every other participant's copy. There is no authoritative
 * copy; each repo is.
 *
 * How the signatures travel (no extra round trip):
 *   - The sender of a final-stage agreement proposal signs the agreement
 *     signing target under DOMAIN_AGREEMENT and attaches the detached
 *     envelope to the proposal body (`agreementSignature`).
 *   - The responder, on accept, verifies the sender's agreement signature,
 *     signs the same target, and attaches its envelope to the response
 *     body.
 *   - After the accept lands, both parties hold both signatures and can
 *     materialize independently.
 *
 * The signing target is the agreement as it will appear in the file —
 * `state: 'agreed'`, `signatures` stripped — so each signature covers the
 * final form, not the proposal-time draft, and neither signature covers
 * the other.
 *
 * Determinism notes:
 *   - signedAt for each participant is pinned to the envelope that carried
 *     their signature (`sentAt`), never to local wall-clock time.
 *   - signatures are sorted by participant DID.
 *   - top-level fields are emitted in AGREEMENT_FIELD_ORDER; any unknown
 *     extra fields follow, sorted. Nested structures keep the key order of
 *     the proposal envelope both parties already share byte-identically.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import type { FlywayAgreement, FlywayAgreementSignature } from './agreements.js'
import type { DidDocument } from './init.js'
import type { ProposalAgreementBody, ProposalBody } from './propose.js'
import type { ProposalResponseBody } from './respond.js'
import { type SignedSignalEnvelope, verifySignedSignal } from './signal.js'
import {
  DOMAIN_AGREEMENT,
  type SignatureEnvelope,
  type Signer,
  signArtifactDetached,
  verifyDetachedSignature,
} from './signing.js'

// ────────────────────────────────────────────────────────────────────────
// Signing target + detached agreement signatures
// ────────────────────────────────────────────────────────────────────────

/**
 * The canonical form both participants sign: the agreement as it will be
 * materialized — state forced to 'agreed', signatures stripped (a
 * signature cannot cover itself or its co-signature).
 */
export function buildAgreementSigningTarget(
  agreement: FlywayAgreement,
): FlywayAgreement {
  const { signatures: _omit, ...rest } = agreement
  return { ...rest, state: 'agreed' }
}

/** Sign the agreement signing target under DOMAIN_AGREEMENT. */
export async function signAgreement(
  agreement: FlywayAgreement,
  signer: Signer,
): Promise<SignatureEnvelope> {
  return signArtifactDetached(
    DOMAIN_AGREEMENT,
    buildAgreementSigningTarget(agreement),
    signer,
  )
}

/** Verify a detached agreement signature against a participant's DID document. */
export async function verifyAgreementSignature(
  agreement: FlywayAgreement,
  envelope: SignatureEnvelope,
  didDocument: DidDocument,
): Promise<boolean> {
  return verifyDetachedSignature(
    DOMAIN_AGREEMENT,
    buildAgreementSigningTarget(agreement),
    envelope,
    didDocument,
  )
}

// ────────────────────────────────────────────────────────────────────────
// materializeAgreement
// ────────────────────────────────────────────────────────────────────────

export interface MaterializeAgreementInput {
  /** The final-stage agreement proposal (from outbox or inbox). */
  readonly proposalEnvelope: SignedSignalEnvelope
  /** The accept response to that proposal (from outbox or inbox). */
  readonly responseEnvelope: SignedSignalEnvelope
  /** DID document of the proposal's sender (recognition-time cached copy when it is the peer). */
  readonly proposerDidDocument: DidDocument
  /** DID document of the response's sender (recognition-time cached copy when it is the peer). */
  readonly responderDidDocument: DidDocument
}

export interface MaterializedAgreement {
  /** The final agreement — state 'agreed', both signatures embedded, fields in canonical order. */
  readonly agreement: FlywayAgreement
  /** Exact file content. Byte-identical across every participant repo. */
  readonly yamlText: string
  /** Repo-relative path the file belongs at: flyway/agreements/<id>.yaml */
  readonly relativePath: string
  /** SHA-256 of yamlText — the cheap cross-repo identity check. */
  readonly sha256: string
}

/**
 * Canonical top-level emission order for materialized agreements —
 * FLYWAY_AGREEMENT_SCHEMA's declaration order. Both parties construct the
 * object in this order so the YAML serialization is byte-identical.
 */
const AGREEMENT_FIELD_ORDER: readonly string[] = [
  'id',
  'schemaVersion',
  'createdAt',
  'participants',
  'driver',
  'purpose',
  'expectations',
  'decisionRule',
  'review',
  'exit',
  'state',
  'signatures',
  'culture',
  'term',
  'metrics',
  'disputeResolution',
  'constraints',
  'concerns',
  'trigger',
  'acceptanceCriteria',
  'originTensionId',
]

const AGREEMENT_FILE_HEADER =
  '# flyway co-signed agreement — byte-identical in every participant repo.\n' +
  '# Do not hand-edit; the signatures cover the canonical form of this document.\n'

/** Same id discipline as signal envelopes; doubles as path-traversal guard. */
const AGREEMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Build the co-signed agreement from the final proposal + accept response.
 *
 * Verifies (each check its own error path, so failures are diagnosable):
 *  - the proposal is a final-stage agreement proposal carrying the
 *    proposer's detached agreement signature
 *  - the response is an accept carrying the responder's detached
 *    agreement signature, and its refs point at the proposal
 *  - the from/to of the two envelopes mirror each other
 *  - both envelope signatures verify (ADR-0009 — never materialize from
 *    unverified antecedents)
 *  - both detached agreement signatures verify over the signing target
 *
 * Pure with respect to the filesystem — writing is `writeAgreementFile`.
 */
export async function materializeAgreement(
  input: MaterializeAgreementInput,
): Promise<MaterializedAgreement> {
  const { proposalEnvelope, responseEnvelope, proposerDidDocument, responderDidDocument } =
    input

  // The proposal side.
  if (proposalEnvelope.kind !== 'proposal') {
    throw new Error(
      `materializeAgreement: proposalEnvelope.kind must be 'proposal' (got: ${proposalEnvelope.kind})`,
    )
  }
  const proposalBody = proposalEnvelope.body as ProposalBody
  if (proposalBody.type !== 'agreement') {
    throw new Error(
      `materializeAgreement: proposal body.type must be 'agreement' (got: ${proposalBody.type})`,
    )
  }
  const stage = proposalBody.stage ?? 'final'
  if (stage !== 'final') {
    throw new Error(
      `materializeAgreement: only final-stage agreement proposals materialize (got stage: ${stage})`,
    )
  }
  const agreementBody = proposalBody as ProposalAgreementBody
  const proposerSignature = agreementBody.agreementSignature
  if (!proposerSignature) {
    throw new Error(
      'materializeAgreement: proposal body carries no agreementSignature — was it produced before S+5b?',
    )
  }
  if (!AGREEMENT_ID_PATTERN.test(agreementBody.agreement.id)) {
    throw new Error(
      `materializeAgreement: agreement.id must match [A-Za-z0-9_-]{1,128} (got: ${agreementBody.agreement.id})`,
    )
  }

  // The response side.
  if (responseEnvelope.kind !== 'respond') {
    throw new Error(
      `materializeAgreement: responseEnvelope.kind must be 'respond' (got: ${responseEnvelope.kind})`,
    )
  }
  const responseBody = responseEnvelope.body as ProposalResponseBody
  if (responseBody.decision !== 'accept') {
    throw new Error(
      `materializeAgreement: response decision must be 'accept' (got: ${responseBody.decision}). ` +
        'Only consented agreements materialize.',
    )
  }
  if (responseEnvelope.refs?.proposalId !== proposalEnvelope.id) {
    throw new Error(
      `materializeAgreement: response refs.proposalId (${responseEnvelope.refs?.proposalId}) ` +
        `does not match proposalEnvelope.id (${proposalEnvelope.id})`,
    )
  }
  if (responseEnvelope.from !== proposalEnvelope.to || responseEnvelope.to !== proposalEnvelope.from) {
    throw new Error(
      'materializeAgreement: response from/to does not mirror the proposal — ' +
        `proposal ${proposalEnvelope.from} → ${proposalEnvelope.to}, ` +
        `response ${responseEnvelope.from} → ${responseEnvelope.to}`,
    )
  }
  const responderSignature = responseBody.agreementSignature
  if (!responderSignature) {
    throw new Error(
      'materializeAgreement: accept response carries no agreementSignature — was it produced before S+5b?',
    )
  }

  // DID document bindings.
  if (proposerDidDocument.id !== proposalEnvelope.from) {
    throw new Error(
      `materializeAgreement: proposerDidDocument.id (${proposerDidDocument.id}) does not ` +
        `match proposalEnvelope.from (${proposalEnvelope.from})`,
    )
  }
  if (responderDidDocument.id !== responseEnvelope.from) {
    throw new Error(
      `materializeAgreement: responderDidDocument.id (${responderDidDocument.id}) does not ` +
        `match responseEnvelope.from (${responseEnvelope.from})`,
    )
  }

  // Envelope signatures (ADR-0009 — never materialize from unverified antecedents).
  if (!(await verifySignedSignal(proposalEnvelope, proposerDidDocument))) {
    throw new Error(
      'materializeAgreement: proposal envelope signature does not verify against the proposer DID document',
    )
  }
  if (!(await verifySignedSignal(responseEnvelope, responderDidDocument))) {
    throw new Error(
      'materializeAgreement: response envelope signature does not verify against the responder DID document',
    )
  }

  // Detached agreement signatures — the material that goes into the file.
  const agreement = agreementBody.agreement
  if (!(await verifyAgreementSignature(agreement, proposerSignature, proposerDidDocument))) {
    throw new Error(
      'materializeAgreement: proposer agreementSignature does not verify over the signing target',
    )
  }
  if (!(await verifyAgreementSignature(agreement, responderSignature, responderDidDocument))) {
    throw new Error(
      'materializeAgreement: responder agreementSignature does not verify over the signing target',
    )
  }

  // Assemble the final document. signedAt pins to the envelope that
  // carried each signature — deterministic on every repo.
  const signatures: FlywayAgreementSignature[] = [
    {
      participant: proposalEnvelope.from,
      signedAt: proposalEnvelope.sentAt,
      signature: proposerSignature.signature,
      verificationKeyId: proposerSignature.verificationKeyId,
    },
    {
      participant: responseEnvelope.from,
      signedAt: responseEnvelope.sentAt,
      signature: responderSignature.signature,
      verificationKeyId: responderSignature.verificationKeyId,
    },
  ].sort((a, b) => (a.participant < b.participant ? -1 : a.participant > b.participant ? 1 : 0))

  const finalAgreement = orderAgreementFields({
    ...buildAgreementSigningTarget(agreement),
    signatures,
  })

  const yamlText = AGREEMENT_FILE_HEADER + yamlStringify(finalAgreement)
  const sha256 = createHash('sha256').update(yamlText, 'utf-8').digest('hex')

  return {
    agreement: finalAgreement,
    yamlText,
    relativePath: join('flyway', 'agreements', `${agreement.id}.yaml`),
    sha256,
  }
}

/**
 * Re-key the agreement into canonical emission order. Known fields follow
 * AGREEMENT_FIELD_ORDER; unknown extras (forward-compat) follow, sorted —
 * they are covered by the signatures, so they must not be dropped.
 */
function orderAgreementFields(agreement: FlywayAgreement): FlywayAgreement {
  const source = agreement as unknown as Record<string, unknown>
  const ordered: Record<string, unknown> = {}
  for (const key of AGREEMENT_FIELD_ORDER) {
    if (source[key] !== undefined) ordered[key] = source[key]
  }
  const extras = Object.keys(source)
    .filter((k) => !AGREEMENT_FIELD_ORDER.includes(k) && source[k] !== undefined)
    .sort()
  for (const key of extras) ordered[key] = source[key]
  return ordered as unknown as FlywayAgreement
}

// ────────────────────────────────────────────────────────────────────────
// On-disk placement
// ────────────────────────────────────────────────────────────────────────

export function agreementFilePath(repoCwd: string, agreementId: string): string {
  if (!AGREEMENT_ID_PATTERN.test(agreementId)) {
    throw new Error(
      `agreementFilePath: agreement id must match [A-Za-z0-9_-]{1,128} (got: ${agreementId})`,
    )
  }
  return join(repoCwd, 'flyway', 'agreements', `${agreementId}.yaml`)
}

/**
 * Write a materialized agreement into a repo. Same idempotency discipline
 * as signal files: identical re-write is a no-op; differing bytes at the
 * same path are an attempt to overwrite an agreement and are refused.
 */
export function writeAgreementFile(
  repoCwd: string,
  materialized: MaterializedAgreement,
): { path: string; created: boolean } {
  const path = agreementFilePath(repoCwd, materialized.agreement.id)
  const dir = path.substring(0, path.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(path, materialized.yamlText, { flag: 'wx' })
    return { path, created: true }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    const existing = readFileSync(path, 'utf-8')
    if (existing === materialized.yamlText) {
      return { path, created: false }
    }
    throw new Error(
      `writeAgreementFile: refusing to overwrite ${path} with different content (agreement id reuse?)`,
    )
  }
}

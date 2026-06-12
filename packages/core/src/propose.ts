/**
 * flyway_propose — send a directive, project, or engagement agreement
 * to a recognized peer.
 *
 * Three proposal types share the same envelope plumbing but differ in
 * what the body carries:
 *   - directive: a specific task / request. Markdown body.
 *   - project:   a scoped collaboration with a deliverable. Markdown body.
 *   - agreement: a standing engagement agreement. Carries a structured
 *                FlywayAgreement that conforms to FLYWAY_AGREEMENT_SCHEMA.
 *
 * Proposals can be staged through the S3 §IV.1.9–1.10 proposal-forming
 * chain (driver → requirements → draft → refinement → final). Each
 * non-initial stage carries a `previousStageId` and, per ADR-0009, must
 * supply the prior proposal as an antecedent for verification.
 *
 * A proposal may also promote a prior tension by setting
 * `refs.tensionId` + supplying the tension as an antecedent. The
 * promotion is one-way: a tension can be promoted, but a proposal
 * doesn't become a tension.
 */

import {
  type FlywayAgreement,
  FLYWAY_AGREEMENT_SCHEMA_VERSION,
  FLYWAY_DECISION_RULES,
} from './agreements.js'
import type { DidDocument } from './init.js'
import {
  type BuildSignedSignalInput,
  type SignalRefs,
  type SignedSignalEnvelope,
  buildSignedSignal,
  verifySignedSignal,
} from './signal.js'
import { signAgreement } from './materialize.js'
import type { SignatureEnvelope, Signer } from './signing.js'

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type ProposalType = 'directive' | 'project' | 'agreement'

export const PROPOSAL_TYPES: readonly ProposalType[] = [
  'directive',
  'project',
  'agreement',
] as const

export type ProposalStage =
  | 'driver'
  | 'requirements'
  | 'draft'
  | 'refinement'
  | 'final'

export const PROPOSAL_STAGES: readonly ProposalStage[] = [
  'driver',
  'requirements',
  'draft',
  'refinement',
  'final',
] as const

/**
 * Structured requirement, used in proposal bodies at stage='requirements'
 * (per Issue #6). The id is stable across refinement so reviewers can
 * trace which requirements survive into the final proposal.
 */
export interface ProposalRequirement {
  readonly id: string
  readonly description: string
  /** Strength of the requirement. Defaults to 'must' if absent. */
  readonly mustOrShould?: 'must' | 'should'
  readonly rationale?: string
}

interface ProposalBodyBase {
  readonly type: ProposalType
  readonly title: string
  /** Markdown free-text describing the proposal. */
  readonly body: string
  /** S3 staging chain position. Defaults to 'final' if absent. */
  readonly stage?: ProposalStage
  /** Id of the prior proposal in the staging chain. Required for refinement. */
  readonly previousStageId?: string
  /** Optional ISO 8601 date by which a response is needed. */
  readonly deadline?: string
  /** Structured requirements list — present iff stage === 'requirements'. */
  readonly requirements?: readonly ProposalRequirement[]
}

export interface ProposalDirectiveBody extends ProposalBodyBase {
  readonly type: 'directive'
}

export interface ProposalProjectBody extends ProposalBodyBase {
  readonly type: 'project'
}

export interface ProposalAgreementBody extends ProposalBodyBase {
  readonly type: 'agreement'
  /**
   * Structured agreement body. Must conform to FLYWAY_AGREEMENT_SCHEMA
   * (#schemaVersion = FLYWAY_AGREEMENT_SCHEMA_VERSION; required fields
   * present; participants includes sender and recipient).
   */
  readonly agreement: FlywayAgreement
  /**
   * Detached DOMAIN_AGREEMENT signature over the agreement signing target
   * ({...agreement, state: 'agreed'}, signatures stripped). Derived by
   * createProposal at stage='final' — callers must NOT supply it. The
   * accept response carries the responder's counterpart, after which both
   * parties can materialize flyway/agreements/<id>.yaml independently.
   */
  readonly agreementSignature?: SignatureEnvelope
}

export type ProposalBody =
  | ProposalDirectiveBody
  | ProposalProjectBody
  | ProposalAgreementBody

/**
 * Antecedent material for ADR-0009 verification. Caller supplies the
 * envelope and the sender's DID document; createProposal verifies them
 * before signing.
 */
export interface ProposalAntecedent {
  readonly envelope: SignedSignalEnvelope
  readonly senderDidDocument: DidDocument
}

export interface CreateProposalInput {
  readonly from: string
  readonly to: string
  readonly body: ProposalBody
  readonly signer: Signer
  /**
   * Required when body.refs.tensionId would be set, i.e. when promoting
   * a prior tension into a proposal. Antecedent verification per
   * ADR-0009 — the tension must verify under the supplied DID document.
   */
  readonly tensionAntecedent?: ProposalAntecedent
  /**
   * Required when body.previousStageId is set, i.e. when continuing a
   * staging chain. Antecedent verification — the prior proposal must
   * verify, must have id matching previousStageId, and must have a
   * compatible stage per stage-transition rules.
   */
  readonly proposalAntecedent?: ProposalAntecedent
  readonly id?: string
  readonly now?: Date
}

// ────────────────────────────────────────────────────────────────────────
// Stage transition rules (Issue #8)
// ────────────────────────────────────────────────────────────────────────

/**
 * Valid successor stages for each stage. Same-stage transitions are
 * allowed (e.g. refinement → refinement when iterating). 'final' is
 * terminal; once a chain reaches final, further proposals start a
 * fresh chain.
 */
const VALID_NEXT_STAGES: Readonly<Record<ProposalStage, readonly ProposalStage[]>> = {
  driver: ['driver', 'requirements', 'draft', 'final'],
  requirements: ['requirements', 'draft', 'refinement', 'final'],
  draft: ['draft', 'refinement', 'final'],
  refinement: ['refinement', 'final'],
  final: [],
}

export function isValidStageTransition(
  previous: ProposalStage,
  current: ProposalStage,
): boolean {
  return VALID_NEXT_STAGES[previous].includes(current)
}

// ────────────────────────────────────────────────────────────────────────
// createProposal
// ────────────────────────────────────────────────────────────────────────

export async function createProposal(
  input: CreateProposalInput,
): Promise<SignedSignalEnvelope> {
  const { body } = input

  validateBaseFields(body)
  validateTypeSpecificFields(body, input)
  await validateAndVerifyAntecedents(input)
  const stage = body.stage ?? 'final'
  validateStageRequirements(body, stage)
  validateStageTransition(body, input, stage)

  let normalizedBody = normalizeBody(body)

  // S+5b: a final-stage agreement proposal carries the sender's detached
  // agreement signature, so the responder (and later, any participant)
  // can materialize the co-signed flyway/agreements/<id>.yaml without an
  // extra signature-exchange round trip.
  if (normalizedBody.type === 'agreement' && stage === 'final') {
    const agreementSignature = await signAgreement(normalizedBody.agreement, input.signer)
    normalizedBody = { ...normalizedBody, agreementSignature }
  }

  const refs = computeRefs(input)

  const buildInput: BuildSignedSignalInput = {
    from: input.from,
    to: input.to,
    kind: 'proposal',
    body: normalizedBody,
    signer: input.signer,
    ...(refs !== undefined ? { refs } : {}),
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  }
  return buildSignedSignal(buildInput)
}

// ────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────

function validateBaseFields(body: ProposalBody): void {
  if (!PROPOSAL_TYPES.includes(body.type)) {
    throw new Error(
      `createProposal: type must be one of ${PROPOSAL_TYPES.join(', ')} (got: ${String((body as { type: unknown }).type)})`,
    )
  }
  if (typeof body.title !== 'string' || body.title.trim() === '') {
    throw new Error('createProposal: body.title must be a non-empty string')
  }
  if (typeof body.body !== 'string' || body.body.trim() === '') {
    throw new Error('createProposal: body.body must be a non-empty string')
  }
  if (body.stage !== undefined && !PROPOSAL_STAGES.includes(body.stage)) {
    throw new Error(
      `createProposal: stage must be one of ${PROPOSAL_STAGES.join(', ')} (got: ${String(body.stage)})`,
    )
  }
  if (body.deadline !== undefined) {
    if (typeof body.deadline !== 'string' || Number.isNaN(Date.parse(body.deadline))) {
      throw new Error('createProposal: deadline must be an ISO 8601 datetime string')
    }
  }
}

function validateTypeSpecificFields(
  body: ProposalBody,
  input: CreateProposalInput,
): void {
  if (body.type !== 'agreement') return
  if (body.agreementSignature !== undefined) {
    throw new Error(
      'createProposal: body.agreementSignature is derived by createProposal — ' +
        'refusing a caller-supplied value (it would launder an unverified signature)',
    )
  }
  const agreement = body.agreement
  if (!agreement || typeof agreement !== 'object') {
    throw new Error("createProposal: type='agreement' requires body.agreement (FlywayAgreement object)")
  }
  if (typeof agreement.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(agreement.id)) {
    throw new Error(
      'createProposal: body.agreement.id must match [A-Za-z0-9_-]{1,128} — ' +
        `it becomes the flyway/agreements/<id>.yaml filename (got: ${String(agreement.id)})`,
    )
  }
  if (agreement.schemaVersion !== FLYWAY_AGREEMENT_SCHEMA_VERSION) {
    throw new Error(
      `createProposal: body.agreement.schemaVersion must be '${FLYWAY_AGREEMENT_SCHEMA_VERSION}' ` +
        `(got: '${agreement.schemaVersion}')`,
    )
  }
  const required: readonly (keyof FlywayAgreement)[] = [
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
  ]
  for (const field of required) {
    if (agreement[field] === undefined || agreement[field] === null) {
      throw new Error(
        `createProposal: body.agreement is missing required field '${String(field)}'`,
      )
    }
  }
  if (!Array.isArray(agreement.participants) || agreement.participants.length < 2) {
    throw new Error(
      'createProposal: body.agreement.participants must list at least two DIDs',
    )
  }
  if (!agreement.participants.includes(input.from)) {
    throw new Error(
      `createProposal: body.agreement.participants must include the sender DID (${input.from})`,
    )
  }
  if (!agreement.participants.includes(input.to)) {
    throw new Error(
      `createProposal: body.agreement.participants must include the recipient DID (${input.to})`,
    )
  }
  if (!FLYWAY_DECISION_RULES.includes(agreement.decisionRule)) {
    throw new Error(
      `createProposal: body.agreement.decisionRule must be one of ${FLYWAY_DECISION_RULES.join(', ')} ` +
        `(got: '${agreement.decisionRule}')`,
    )
  }
}

function validateStageRequirements(body: ProposalBody, stage: ProposalStage): void {
  // Structured requirements list — required at stage='requirements' (#6).
  if (stage === 'requirements') {
    if (!Array.isArray(body.requirements) || body.requirements.length === 0) {
      throw new Error(
        "createProposal: stage='requirements' requires a non-empty body.requirements array (Issue #6)",
      )
    }
    for (const [i, req] of body.requirements.entries()) {
      if (typeof req.id !== 'string' || req.id.trim() === '') {
        throw new Error(`createProposal: body.requirements[${i}].id must be a non-empty string`)
      }
      if (typeof req.description !== 'string' || req.description.trim() === '') {
        throw new Error(
          `createProposal: body.requirements[${i}].description must be a non-empty string`,
        )
      }
      if (
        req.mustOrShould !== undefined &&
        req.mustOrShould !== 'must' &&
        req.mustOrShould !== 'should'
      ) {
        throw new Error(
          `createProposal: body.requirements[${i}].mustOrShould must be 'must' or 'should' if set`,
        )
      }
    }
  } else if (body.requirements !== undefined) {
    // Defensive: requirements field on non-requirements stages would be
    // confusing in the signed artifact.
    throw new Error(
      `createProposal: body.requirements is only valid at stage='requirements' (got stage='${stage}')`,
    )
  }
}

function validateStageTransition(
  body: ProposalBody,
  input: CreateProposalInput,
  stage: ProposalStage,
): void {
  // 'refinement' presupposes a prior proposal — refining what? — so
  // previousStageId is mandatory there.
  if (stage === 'refinement' && !body.previousStageId) {
    throw new Error(
      "createProposal: stage='refinement' requires body.previousStageId — refinement of what?",
    )
  }
  // If a previousStageId is supplied, an antecedent must be too (ADR-0009).
  if (body.previousStageId !== undefined && !input.proposalAntecedent) {
    throw new Error(
      'createProposal: body.previousStageId requires proposalAntecedent (the prior proposal envelope + sender DID document) per ADR-0009',
    )
  }
  // If we have an antecedent proposal, its stage must permit this transition.
  if (input.proposalAntecedent) {
    const priorBody = input.proposalAntecedent.envelope.body as ProposalBody
    const priorStage = priorBody.stage ?? 'final'
    if (!isValidStageTransition(priorStage, stage)) {
      throw new Error(
        `createProposal: invalid stage transition from '${priorStage}' to '${stage}'. ` +
          `Valid successors of '${priorStage}': [${VALID_NEXT_STAGES[priorStage].join(', ')}]`,
      )
    }
    // previousStageId must match the antecedent's id.
    if (body.previousStageId !== input.proposalAntecedent.envelope.id) {
      throw new Error(
        `createProposal: body.previousStageId (${body.previousStageId}) does not match ` +
          `proposalAntecedent.envelope.id (${input.proposalAntecedent.envelope.id})`,
      )
    }
  }
}

async function validateAndVerifyAntecedents(input: CreateProposalInput): Promise<void> {
  if (input.tensionAntecedent) {
    const { envelope, senderDidDocument } = input.tensionAntecedent
    if (envelope.kind !== 'tension') {
      throw new Error(
        `createProposal: tensionAntecedent.envelope.kind must be 'tension' (got: '${envelope.kind}')`,
      )
    }
    if (senderDidDocument.id !== envelope.from) {
      throw new Error(
        `createProposal: tensionAntecedent.senderDidDocument.id (${senderDidDocument.id}) ` +
          `does not match envelope.from (${envelope.from})`,
      )
    }
    const ok = await verifySignedSignal(envelope, senderDidDocument)
    if (!ok) {
      throw new Error(
        'createProposal: tensionAntecedent signature does not verify against the supplied DID document. ' +
          'Refusing to promote a tampered or stale tension.',
      )
    }
  }
  if (input.proposalAntecedent) {
    const { envelope, senderDidDocument } = input.proposalAntecedent
    if (envelope.kind !== 'proposal') {
      throw new Error(
        `createProposal: proposalAntecedent.envelope.kind must be 'proposal' (got: '${envelope.kind}')`,
      )
    }
    if (senderDidDocument.id !== envelope.from) {
      throw new Error(
        `createProposal: proposalAntecedent.senderDidDocument.id (${senderDidDocument.id}) ` +
          `does not match envelope.from (${envelope.from})`,
      )
    }
    const ok = await verifySignedSignal(envelope, senderDidDocument)
    if (!ok) {
      throw new Error(
        'createProposal: proposalAntecedent signature does not verify against the supplied DID document. ' +
          'Refusing to continue a chain from a tampered or stale proposal.',
      )
    }
  }
}

function normalizeBody(body: ProposalBody): ProposalBody {
  // Reconstruct the body to ensure undefined fields are omitted from the
  // signed payload (the canonicalizer drops them, but explicit construction
  // makes intent visible).
  const base = {
    type: body.type,
    title: body.title,
    body: body.body,
    stage: body.stage ?? 'final',
    ...(body.previousStageId !== undefined
      ? { previousStageId: body.previousStageId }
      : {}),
    ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
    ...(body.requirements !== undefined ? { requirements: body.requirements } : {}),
  } as const
  if (body.type === 'agreement') {
    return { ...base, type: 'agreement', agreement: body.agreement } satisfies ProposalAgreementBody
  }
  return base as ProposalDirectiveBody | ProposalProjectBody
}

function computeRefs(input: CreateProposalInput): SignalRefs | undefined {
  const tensionId = input.tensionAntecedent?.envelope.id
  const proposalId = input.proposalAntecedent?.envelope.id
  // inReplyTo defaults to the most-specific reference: proposal chain
  // continuation, then tension promotion, then none.
  const inReplyTo = proposalId ?? tensionId
  if (!tensionId && !proposalId) return undefined
  return {
    ...(tensionId !== undefined ? { tensionId } : {}),
    ...(proposalId !== undefined ? { proposalId } : {}),
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
  }
}

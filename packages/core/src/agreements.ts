/**
 * Schema for flyway engagement agreements — the structured documents
 * committed to participating repos when two or more Sources formalize a
 * collaboration.
 *
 * Dual-licensed:
 *   - MIT (with the rest of flyway)
 *   - CC BY-SA 4.0, because the field design paraphrases Sociocracy 3.0
 *     §IV.7.1 (Contract for Successful Collaboration) and §IV.7.2 (Record
 *     Governance Decisions). See ADR-0005.
 *
 * Canonical reference: docs/concepts/S3-practical-guide.pdf
 * Authors: Bockelbrink, Priest, David
 *
 * S3 patterns this schema is derived from:
 *   - §IV.1.3 Describe Organizational Drivers (the driver subfield)
 *   - §IV.7.1 Contract for Successful Collaboration (success criteria,
 *     lifecycle, exit terms, culture)
 *   - §IV.7.2 Record Governance Decisions (metadata: id, version, dates,
 *     signatures)
 */

import type { JsonSchema } from './types.js'

export const FLYWAY_AGREEMENT_SCHEMA_VERSION = '0.1.0'

export type FlywayDecisionRule =
  | 's3-consent'
  | 'lazy-consent'
  | 'dual-source-sign'
  | 'weighted-vote-bounded'
  | 'apache-vote'

export type FlywayAgreementState =
  | 'proposed'
  | 'agreed'
  | 'in-flight'
  | 'suspended'
  | 'closed'

export interface FlywayAgreementDriver {
  readonly conditions: string
  readonly effect: string
  readonly relevance?: string
}

export interface FlywayAgreementExpectation {
  readonly participant: string
  readonly description: string
}

export interface FlywayAgreementReview {
  readonly cadence: string
  readonly nextDate?: string
  readonly protocol?: string
}

export interface FlywayAgreementExit {
  readonly notice: string
  readonly breach?: string
  readonly inFlightWork?: string
}

export interface FlywayAgreementSignature {
  readonly participant: string
  readonly signedAt: string
  readonly signature: string
  /**
   * Optional DID URL of the verification method the signature was made
   * with (e.g. 'did:web:…#key-1'). Lets the materialized file be
   * verified standalone, without consulting the signal envelopes that
   * carried the signature.
   */
  readonly verificationKeyId?: string
}

export interface FlywayAgreementTerm {
  readonly startDate?: string
  readonly endDate?: string
  readonly renewable?: boolean
}

export interface FlywayAgreementMetric {
  readonly name: string
  readonly target?: string
  readonly monitoringSchedule?: string
}

export interface FlywayAgreementAcceptanceCriterion {
  readonly id: string
  readonly description: string
}

export interface FlywayAgreement {
  readonly id: string
  readonly schemaVersion: string
  readonly createdAt: string
  readonly participants: readonly string[]
  readonly driver: FlywayAgreementDriver
  readonly purpose: string
  readonly expectations: readonly FlywayAgreementExpectation[]
  readonly decisionRule: FlywayDecisionRule
  readonly review: FlywayAgreementReview
  readonly exit: FlywayAgreementExit
  readonly state: FlywayAgreementState
  readonly signatures?: readonly FlywayAgreementSignature[]
  readonly culture?: string
  readonly term?: FlywayAgreementTerm
  readonly metrics?: readonly FlywayAgreementMetric[]
  readonly disputeResolution?: string
  readonly constraints?: readonly string[]
  readonly concerns?: readonly string[]
  /** Optional operable trigger — the observable event that activates this agreement. (Issue #7) */
  readonly trigger?: string
  /** Optional acceptance criteria — what counts as "this agreement is being honored." (Issue #7) */
  readonly acceptanceCriteria?: readonly FlywayAgreementAcceptanceCriterion[]
}

export const FLYWAY_DECISION_RULES: readonly FlywayDecisionRule[] = [
  's3-consent',
  'lazy-consent',
  'dual-source-sign',
  'weighted-vote-bounded',
  'apache-vote',
] as const

export const FLYWAY_AGREEMENT_STATES: readonly FlywayAgreementState[] = [
  'proposed',
  'agreed',
  'in-flight',
  'suspended',
  'closed',
] as const

export const FLYWAY_AGREEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'A flyway engagement agreement — the structured, co-signed document ' +
    'between two or more recognized Sources. Committed byte-for-byte to ' +
    'flyway/agreements/<id>.yaml in each participant repo. See ' +
    'docs/concepts/agreement-template.md for an annotated example.',
  properties: {
    id: {
      type: 'string',
      description:
        'Unique identifier for this agreement (ULID, UUID, or content hash). ' +
        'Stable across the agreement\'s lifecycle.',
    },
    schemaVersion: {
      type: 'string',
      description:
        'Version of the flyway agreement schema this document conforms to.',
    },
    createdAt: {
      type: 'string',
      description: 'ISO 8601 datetime when the agreement was first co-created.',
    },
    participants: {
      type: 'array',
      description:
        'DIDs of the participating Sources. At least two; each must be a ' +
        'recognized peer in flyway/peers.yaml.',
      items: { type: 'string' },
    },
    driver: {
      type: 'object',
      description:
        'The organizational driver — the situation worth responding to ' +
        '(S3 §IV.1.3 Describe Organizational Drivers).',
      properties: {
        conditions: {
          type: 'string',
          description:
            'Current conditions observed — concrete, specific, objective. ' +
            'Describe what is happening, not what is missing or lacking.',
        },
        effect: {
          type: 'string',
          description:
            'The current or anticipated effect those conditions lead to. ' +
            'Be explicit whether the effect is already occurring or anticipated.',
        },
        relevance: {
          type: 'string',
          description:
            'Why this is relevant in the shared context. Omit if obvious ' +
            'from conditions and effect.',
        },
      },
      required: ['conditions', 'effect'],
    },
    purpose: {
      type: 'string',
      description:
        'Summary of the intended outcome — what the collaboration is for ' +
        '(S3 §IV.7.1, §IV.7.2).',
    },
    expectations: {
      type: 'array',
      description:
        'What each participant commits to do under this agreement. Every ' +
        'participant DID should appear at least once. S3 §IV.7.1 success ' +
        'criterion: "all parties understand what is expected of them."',
      items: {
        type: 'object',
        properties: {
          participant: {
            type: 'string',
            description: 'DID of the participant this expectation applies to.',
          },
          description: {
            type: 'string',
            description: 'What this participant commits to do.',
          },
        },
        required: ['participant', 'description'],
      },
    },
    decisionRule: {
      type: 'string',
      enum: [
        's3-consent',
        'lazy-consent',
        'dual-source-sign',
        'weighted-vote-bounded',
        'apache-vote',
      ],
      description:
        'Decision rule governing changes to this agreement. Defaults to ' +
        's3-consent. See docs/concepts/consent-mechanisms.md.',
    },
    review: {
      type: 'object',
      description:
        'When and how the agreement is reviewed (S3 §IV.7.1 — "define and ' +
        'build into the contract regular review meetings").',
      properties: {
        cadence: {
          type: 'string',
          description:
            'How often the agreement is reviewed (e.g. "quarterly", ' +
            '"monthly", "on milestone").',
        },
        nextDate: {
          type: 'string',
          description: 'ISO 8601 date of the next scheduled review.',
        },
        protocol: {
          type: 'string',
          description: 'How the review is conducted.',
        },
      },
      required: ['cadence'],
    },
    exit: {
      type: 'object',
      description:
        'How a party may exit. Exit is always valid in flyway; this field ' +
        'specifies the transition, not whether exit is permitted (S3 §IV.7.1 ' +
        '— "clear protocol for how each party can terminate the contract").',
      properties: {
        notice: {
          type: 'string',
          description:
            'Notice period before exit takes effect (e.g. "30 days", ' +
            '"immediate").',
        },
        breach: {
          type: 'string',
          description: 'What constitutes breach and how it is handled.',
        },
        inFlightWork: {
          type: 'string',
          description:
            'What happens to work in flight at the time of exit notice.',
        },
      },
      required: ['notice'],
    },
    state: {
      type: 'string',
      enum: ['proposed', 'agreed', 'in-flight', 'suspended', 'closed'],
      description:
        'Current lifecycle state. proposed = drafted, awaiting consent. ' +
        'agreed = all participants have signed; not yet active. ' +
        'in-flight = active. suspended = paused by mutual consent. ' +
        'closed = ended via exit, review, or expiry.',
    },
    signatures: {
      type: 'array',
      description:
        'Signatures from each participant. Required when state is agreed, ' +
        'in-flight, suspended, or closed — every participant DID must appear.',
      items: {
        type: 'object',
        properties: {
          participant: {
            type: 'string',
            description: 'DID of the signer.',
          },
          signedAt: {
            type: 'string',
            description: 'ISO 8601 datetime when the signature was made.',
          },
          signature: {
            type: 'string',
            description:
              'Cryptographic signature over the canonical-form agreement ' +
              '(algorithm specified in the signer\'s entity statement).',
          },
          verificationKeyId: {
            type: 'string',
            description:
              'Optional DID URL of the verification method the signature ' +
              'was made with — lets the file be verified standalone.',
          },
        },
        required: ['participant', 'signedAt', 'signature'],
      },
    },
    culture: {
      type: 'string',
      description:
        'Optional: explicitly describe the culture the collaboration aims ' +
        'to develop (S3 §IV.7.1 — "intentionally create the culture you ' +
        'want to see").',
    },
    term: {
      type: 'object',
      description:
        'Optional: fixed-term bounds. If omitted, the agreement runs until ' +
        'one party exits or both parties close it (S3 §IV.7.1).',
      properties: {
        startDate: { type: 'string', description: 'ISO 8601 date.' },
        endDate: { type: 'string', description: 'ISO 8601 date.' },
        renewable: { type: 'boolean' },
      },
    },
    metrics: {
      type: 'array',
      description:
        'Optional: signals that indicate the agreement is achieving its ' +
        'purpose. From S3 §IV.7.2: "review date, relevant metrics, and how ' +
        'they will be monitored."',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          target: { type: 'string' },
          monitoringSchedule: { type: 'string' },
        },
        required: ['name'],
      },
    },
    disputeResolution: {
      type: 'string',
      description:
        'Optional: provisions for mediation, conciliation, or arbitration ' +
        'beyond default exit (S3 §IV.7.1 — "alternative means for dispute ' +
        'resolution").',
    },
    constraints: {
      type: 'array',
      description:
        'Optional: important constraints (laws, organizational policies, ' +
        'technical limits) the parties must operate within.',
      items: { type: 'string' },
    },
    concerns: {
      type: 'array',
      description:
        'Optional: concerns recorded during the consent round that did not ' +
        'block agreement but are noted (S3 §IV.1.5 Step 9: Consider Concerns).',
      items: { type: 'string' },
    },
    trigger: {
      type: 'string',
      description:
        'Optional: operable trigger — the observable event that activates ' +
        'this agreement. Lets parties know when the agreement is in force ' +
        'without having to interpret start dates.',
    },
    acceptanceCriteria: {
      type: 'array',
      description:
        'Optional: criteria that establish whether the agreement is being ' +
        'honored. Each criterion has a stable id (for referencing in ' +
        'review notes) and a description. Distinct from metrics: ' +
        'acceptance criteria are binary (met/not met); metrics are ' +
        'continuous signals.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id', 'description'],
      },
    },
  },
  required: [
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
  ],
}

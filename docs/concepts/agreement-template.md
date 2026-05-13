# Agreement template

This document shows the canonical shape of a flyway **engagement agreement**
— the structured, co-signed document committed to participating repos when
two or more Sources formalize a collaboration.

The schema is defined and exported as
[`FLYWAY_AGREEMENT_SCHEMA`](../../packages/core/src/agreements.ts) from
`@murmurations-ai/flyway-core`.

> **License note.** Parts of this document paraphrase Sociocracy 3.0 §IV.7.1
> (Contract for Successful Collaboration) and §IV.7.2 (Record Governance
> Decisions), so it is dual-licensed MIT (with the rest of flyway) and
> CC BY-SA 4.0 (with attribution to Bockelbrink, Priest, David). See
> [ADR-0005](../adr/0005-s3-patterns-as-canonical-protocol-vocabulary.md).

## Where agreements live

Per the research paper §6.7, a signed agreement is committed to:

```
<source-repo>/flyway/agreements/<id>.yaml
```

in **every participating repository**. The same document, byte-for-byte, is
committed by each Source. That byte-for-byte identity is what "co-signed"
means in flyway — there is no authoritative copy; each repo is.

## Annotated example

```yaml
# Identity and metadata
id: 01HZX5K7P3MJD9V8R2NA4QFCB6              # ULID or similar; stable for life
schemaVersion: "0.1.0"                       # FLYWAY_AGREEMENT_SCHEMA_VERSION
createdAt: "2026-05-13T14:30:00Z"            # ISO 8601

# Parties — at least two, must be recognized peers
participants:
  - did:web:github.com:xeeban:emergent-praxis
  - did:web:github.com:other-org:other-murmuration

# Driver — the situation worth responding to (S3 §IV.1.3)
driver:
  conditions: |
    Both murmurations regularly produce research summaries on overlapping
    topics, and there is currently no protocol for cross-reference.
  effect: |
    Duplicate effort, inconsistent conclusions, and missed opportunities
    to build on each other's work.
  relevance: |
    Coordinating produces shared reference material both murmurations rely
    on, reducing waste and improving research quality.

# Purpose — the intended outcome
purpose: |
  Establish a standing agreement for cross-referencing research summaries
  and reviewing each other's drafts on shared topics.

# Expectations — what each participant commits to do (S3 §IV.7.1)
expectations:
  - participant: did:web:github.com:xeeban:emergent-praxis
    description: |
      Tag research summaries with the `flyway-shared` label; review peer
      drafts on shared topics within 5 business days of request.
  - participant: did:web:github.com:other-org:other-murmuration
    description: |
      Tag research summaries with the `flyway-shared` label; review peer
      drafts on shared topics within 5 business days of request.

# Decision rule governing future changes to this agreement
# Defaults to s3-consent; see docs/concepts/consent-mechanisms.md for options
decisionRule: s3-consent

# Review cadence (S3 §IV.7.1 — regular review meetings)
review:
  cadence: quarterly
  nextDate: "2026-08-13"
  protocol: |
    Joint async retrospective via a shared GitHub issue with the
    `flyway-review` label; consent round per S3 §IV.1.5.

# Exit terms (S3 §IV.7.1 — termination protocol)
# Exit is always valid in flyway; this specifies the transition
exit:
  notice: 30 days
  inFlightWork: |
    Any review in flight at the time of notice is completed; no new joint
    commitments are made after notice is given.

# Current lifecycle state
state: agreed

# Cryptographic signatures — required when state is agreed or beyond
signatures:
  - participant: did:web:github.com:xeeban:emergent-praxis
    signedAt: "2026-05-13T14:32:11Z"
    signature: "ed25519:Z0F1QmNkRWZHaElqS2xNbk9wUXJTdFV2V3hZeg..."
  - participant: did:web:github.com:other-org:other-murmuration
    signedAt: "2026-05-13T14:35:42Z"
    signature: "ed25519:QWJjRGVGZ0hpSmtMbU5vUHFSc1R1VnZXeFlaYQ..."

# --- Optional fields below ---

# Culture (S3 §IV.7.1 — intentionally create the culture you want to see)
culture: |
  Reviews are co-creative and substantive; objections are surfaced with
  reasoning per S3; integration is preferred over forcing agreement.

# Fixed-term bounds (omit for open-ended agreements)
# term:
#   startDate: "2026-05-13"
#   endDate: "2027-05-13"
#   renewable: true

# Metrics — signals that the agreement is achieving its purpose
# metrics:
#   - name: "Cross-referenced research summaries per quarter"
#     target: ">= 4"
#     monitoringSchedule: "reviewed at quarterly review"

# Dispute resolution beyond default exit
# disputeResolution: |
#   Before exit, parties will attempt mediation by a mutually agreed third
#   Source. If mediation does not resolve the dispute within 30 days,
#   default exit terms apply.

# Constraints — laws, organizational policies, technical limits
# constraints:
#   - "All shared research must comply with each organization's IP policy"

# Concerns recorded during consent round (S3 §IV.1.5 Step 9)
# concerns:
#   - "Review cycle of 5 business days may be too tight during summer holidays"
```

## Field reference

| Field             | Required | Source                          |
| ----------------- | -------- | ------------------------------- |
| `id`              | yes      | flyway bookkeeping              |
| `schemaVersion`   | yes      | flyway bookkeeping              |
| `createdAt`       | yes      | S3 §IV.7.2 (date of creation)   |
| `participants`    | yes      | flyway peer recognition         |
| `driver`          | yes      | S3 §IV.1.3                      |
| `purpose`         | yes      | S3 §IV.7.1, §IV.7.2             |
| `expectations`    | yes      | S3 §IV.7.1 (what is expected)   |
| `decisionRule`    | yes      | flyway consent mechanisms       |
| `review`          | yes      | S3 §IV.7.1 (regular review)     |
| `exit`            | yes      | S3 §IV.7.1 (termination)        |
| `state`           | yes      | flyway agreement lifecycle      |
| `signatures`      | required when `state >= 'agreed'` | flyway identity |
| `culture`         | no       | S3 §IV.7.1 (Culture)            |
| `term`            | no       | S3 §IV.7.1 (fixed term)         |
| `metrics`         | no       | S3 §IV.7.2                      |
| `disputeResolution` | no     | S3 §IV.7.1 (alt. means)         |
| `constraints`     | no       | S3 §IV.7.1 (laws/regs)          |
| `concerns`        | no       | S3 §IV.1.5 Step 9               |

## How an agreement is created

The agent flow is:

1. **Tension or proposal** — a Source recognizes a driver worth a standing
   agreement (often via `flyway_tension` first, then promoted).
2. **Co-create the draft** — one Source uses `flyway_propose` with
   `type: agreement` and a body conforming to this schema. The proposal is
   mirrored to the peer's repo.
3. **Consent cycle** — the peer responds via `flyway_respond`; objections
   are integrated through revision (S3 §IV.1.7).
4. **Sign** — when all participants consent, each Source signs and the
   resulting YAML is committed byte-for-byte to both repos as
   `flyway/agreements/<id>.yaml`. The `state` becomes `agreed`.
5. **Activate** — `state` becomes `in-flight` when the agreement's start
   conditions are met.
6. **Review** — at the cadence specified in `review`, parties revisit.
7. **Close or evolve** — agreements close via exit, expiry, or mutual
   close. Changes to an active agreement follow the `decisionRule`.

## Why this much structure?

S3 §IV.7.1 lists six success criteria for a contract negotiation. The
required fields above map to those criteria:

| S3 success criterion (§IV.7.1)                          | flyway field(s)                  |
| ------------------------------------------------------- | -------------------------------- |
| Shared understanding of reason for the collaboration    | `driver`                         |
| Intended outcome and important constraints              | `purpose`, `constraints`         |
| All parties understand what is expected of them         | `expectations`                   |
| All parties involved voluntarily                        | `participants`, `signatures`     |
| Expectations are realistic                              | `expectations`, `term`           |
| Beneficial to all parties                               | `purpose`, `metrics`             |
| Everyone intends to keep to the agreement               | `signatures` (cryptographic)     |

Without this structure, "we agreed to collaborate" is too vague to be
auditable. With it, every commitment is explicit and every Source has the
same document to point at when ambiguity arises.

## See also

- [`sociocracy-3.md`](./sociocracy-3.md) — S3 primer
- [`consent-mechanisms.md`](./consent-mechanisms.md) — the five decision rules
- [`defining-source.md`](./defining-source.md) — who participants are
- [`S3-practical-guide.pdf`](./S3-practical-guide.pdf) §IV.7 — canonical source

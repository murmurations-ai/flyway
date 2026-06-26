---
date: 2026-06-17
protocol-version: 0.1.0
code-sha: 4c894b6
kind: executable
tools-exercised: [flyway_init, flyway_recognize, flyway_tension, flyway_respond, flyway_propose, flyway_check]
also-exercised: [flyway materialize]
outcome: a tension is promoted through the full S3 proposal-forming chain (driver → requirements → draft → refinement → final) with a real objection integrated mid-chain, ending in a co-signed agreement that records the integration
---

# Tier 5 — The full staging chain, with an objection integrated

Fifth **executable** walkthrough, and the one the [Tier 4 walkthrough](./2026-06-12-tier4-cosigned-agreement.md)
explicitly starts past. Tier 4 jumped straight to a `stage: final`
agreement. This walkthrough runs the **whole S3 proposal-forming cycle**
(§IV.1.9–1.10) end-to-end: a tension is acknowledged, promoted to a
`driver`-stage proposal, advanced through `requirements` and `draft`,
**objected to**, refined to integrate the objection, and only then
finalized and co-signed. The integration is visible in the final
agreement: an expectation moves from one Source to the other because a
peer objected and the author revised.

This is the proof that flyway carries *governance*, not just message
delivery — that an objection is a first-class move that changes the
outcome, exactly as S3 §IV.1.6 (Consent Decision Making) and §IV.1.7
(Resolve Objections) intend.

## What this proves

| Claim | Evidence |
| --- | --- |
| A tension can be promoted into a proposal chain. | The `driver`-stage proposal carries `refs.tensionId` pointing at the acknowledged tension; promotion is verified per ADR-0009 before signing. |
| The staging chain is enforced, not decorative. | Each non-initial stage carries `previousStageId` + the prior proposal as a verified antecedent; the stage transition (`draft → refinement`, etc.) is validated against the antecedent's stage. |
| An objection is first-class and binding on the author's next move. | B's `object` at the `draft` stage carries a reason; A's next proposal is a `refinement` whose `previousStageId` is exactly the objected-to draft. |
| Integration actually changes the artifact. | The objection — "facilitation and the log both fall on Andamio" — moves the shared-tension-log expectation from Andamio (A) to Praxis (B) in the refinement, and that split is what lands in the final co-signed agreement. |
| The whole chain reconciles cryptographically. | All six A→B signals verify in B's `flyway_check`; the final agreement materializes byte-identically on both repos (SHA-256 `ab6b1975…`). |
| The agreement remembers where it came from. | The final agreement's `driver` is the same driver surfaced as the original tension — the audit trail runs tension → driver → … → agreement. |

## What this does NOT prove

- ~~**A schema-level back-link from agreement to tension.**~~ **Resolved
  after this capture (Issue #2 / G8).** At the time of this walkthrough the
  agreement only *restated* the driver. Since then, `flyway_propose`
  propagates the verified `refs.tensionId` forward through every stage and
  auto-stamps it onto the final agreement as `originTensionId` — a field
  covered by both co-signatures and refused if it disagrees with the chain.
  A machine can now follow agreement → tension by reference, not just a
  human reading both. (Re-running the script below at the current SHA emits
  `originTensionId: <tension id>` in `agreements/<id>.yaml`.)
- **Bidirectional authorship.** The chain is authored by A; B consents or
  objects. A genuinely co-authored chain (both Sources editing stages) is
  not modelled — `previousStageId` resolves only from the author's own
  outbox.
- **Objection at the `final` stage.** Here the objection lands at `draft`
  and is resolved before `final`. An objection *to the final agreement
  itself* would simply be a non-`accept` response that never materializes —
  exercised in Tier 4's refusal cases, not here.
- **Signals at a distance.** Local-fs transport only.

## Setup

Two mutually-recognized murmurations, same as the earlier tiers.

| Murmuration | DID                                  | Source | Mode        |
| ----------- | ------------------------------------ | ------ | ----------- |
| A           | `did:web:github.com:xeeban:a`        | Nori   | interactive |
| B           | `did:web:github.com:emergent:praxis` | Praxis | interactive |

The chain authored by A, stage by stage, with B's response to each:

| # | A sends | stage | B responds |
| - | ------- | ----- | ---------- |
| 1 | `flyway_tension` | — | `acknowledge` |
| 2 | `flyway_propose` (promote tension) | `driver` | `accept` |
| 3 | `flyway_propose` | `requirements` | `accept` (+ concern recorded) |
| 4 | `flyway_propose` | `draft` | **`object`** (one-sided) |
| 5 | `flyway_propose` (integrates objection) | `refinement` | `accept` |
| 6 | `flyway_propose` (agreement body) | `final` | `accept` → co-sign |

## Reproducible script

Verbatim from SHA `4c894b6`. The `requirements.yaml` and `agreement.json`
sidecars are shown after the script.

```bash
A=$(mktemp -d) && B=$(mktemp -d) && CLI=./packages/cli/dist/bin/flyway.js
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Nori")
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Praxis")
(cd "$A" && node "$CLI" recognize "$B"); (cd "$B" && node "$CLI" recognize "$A")

# 1. A surfaces a tension; B acknowledges
T=$(cd "$A" && node "$CLI" tension "$B" \
  --conditions "Andamio and Praxis both run weekly retros, but neither sees the other's cross-circle tensions until they reach governance." \
  --effect "The same coordination problem gets re-litigated in two places a week apart." \
  --relevance "A shared retro cadence would surface tensions once, early, to both Sources." | awk '/^  id:/{print $2}')
(cd "$B" && node "$CLI" respond "$A" --subject-id "$T" --decision acknowledge \
  --reason "Agreed — we feel the same double-handling on our side.")

# 2. driver (promotes the tension); B accepts
DRIVER=$(cd "$A" && node "$CLI" propose "$B" --type project --title "Shared cross-murmuration retro" \
  --body "Driver: surface cross-circle tensions once, early, to both Sources …" \
  --stage driver --promote-tension-id "$T" | awk '/^  id:/{print $2}')
(cd "$B" && node "$CLI" respond "$A" --subject-id "$DRIVER" --decision accept --reason "Yes, this is worth a proposal.")

# 3. requirements; B accepts with a recorded concern
REQS=$(cd "$A" && node "$CLI" propose "$B" --type project --title "Shared cross-murmuration retro" \
  --body "Requirements for the shared retro, derived from the accepted driver." \
  --stage requirements --previous-stage-id "$DRIVER" --requirements-file "$A/requirements.yaml" | awk '/^  id:/{print $2}')
(cd "$B" && node "$CLI" respond "$A" --subject-id "$REQS" --decision accept \
  --concern "Watch that R2's shared log doesn't become a place tensions go to die.")

# 4. draft; B OBJECTS — the work is one-sided
DRAFT=$(cd "$A" && node "$CLI" propose "$B" --type project --title "Shared cross-murmuration retro" \
  --body "Draft: weekly 30-min retro, Nori (Andamio) facilitates and circulates notes; Praxis attends and brings one tension." \
  --stage draft --previous-stage-id "$REQS" | awk '/^  id:/{print $2}')
(cd "$B" && node "$CLI" respond "$A" --subject-id "$DRAFT" --decision object \
  --reason "Facilitation and note-taking both fall on Andamio — that's a standing imbalance. Praxis should own the shared tension log so the work is split.")

# 5. refinement integrates the objection; B accepts
REFINE=$(cd "$A" && node "$CLI" propose "$B" --type project --title "Shared cross-murmuration retro" \
  --body "Refinement (integrates Praxis's objection): Andamio facilitates and circulates notes; PRAXIS owns the shared tension log. Work is now split." \
  --stage refinement --previous-stage-id "$DRAFT" | awk '/^  id:/{print $2}')
(cd "$B" && node "$CLI" respond "$A" --subject-id "$REFINE" --decision accept --reason "The split addresses it. No objection.")

# 6. final agreement; B accepts → both materialize
FINAL=$(cd "$A" && node "$CLI" propose "$B" --type agreement --title "Shared cross-murmuration retro" \
  --body "Final agreement, integrating the split." \
  --stage final --previous-stage-id "$REFINE" --agreement-file "$A/agreement.json" | awk '/^  id:/{print $2}')
RESP=$(cd "$B" && node "$CLI" respond "$A" --subject-id "$FINAL" --decision accept --reason "Consent. This is the agreement." | awk '/^  id:/{print $2}')
(cd "$A" && node "$CLI" materialize "$B" --response-id "$RESP")
(cd "$B" && node "$CLI" materialize "$A" --response-id "$RESP")
diff "$A/flyway/agreements/shared-retro-2026.yaml" "$B/flyway/agreements/shared-retro-2026.yaml" && echo "byte-identical"
```

`requirements.yaml` (stage 3 sidecar):

```yaml
- id: R1
  description: A single weekly retro both murmurations attend.
  mustOrShould: must
  rationale: One retro is the whole point — two defeats it.
- id: R2
  description: Tensions surfaced in the retro are logged where both Sources can see them.
  mustOrShould: must
- id: R3
  description: The cadence is reviewable monthly and either party can adjust it.
  mustOrShould: should
  rationale: Cadence that can't flex gets abandoned.
```

## Transcript — the load-bearing moments

The full per-command output is long; the moments that matter are the
objection and its integration.

### Stage 4 — B objects to the draft

```
$ flyway respond <A> --subject-id 1781717100037-1f1efe99 --decision object \
    --reason "Facilitation and note-taking both fall on Andamio — that's a standing
              imbalance. Praxis should own the shared tension log so the work is split."
Responded to proposal 1781717100037-1f1efe99 from did:web:github.com:xeeban:a
  decision: object
  id:       1781717100142-0a493bc4
```

The objection as it lands in A's inbox — the reason is part of the signed
body, and `refs.proposalId` binds it to the exact draft objected to:

```yaml
body:
  decision: object
  reason: Facilitation and note-taking both fall on Andamio — that's a standing
    imbalance. Praxis should own the shared tension log so the work is split.
refs:
  proposalId: 1781717100037-1f1efe99
  inReplyTo: 1781717100037-1f1efe99
```

### Stage 5 — A integrates, in a refinement chained to the objected draft

```
$ flyway propose <B> --type project --stage refinement \
    --previous-stage-id 1781717100037-1f1efe99 \
    --body "Refinement (integrates Praxis's objection): … PRAXIS owns the shared tension log …"
```

The refinement's signed body records the chain link back to the draft B
objected to — the protocol can see that this refinement *answers* that
objection:

```yaml
body:
  …
  stage: refinement
  previousStageId: 1781717100037-1f1efe99
refs:
  proposalId: 1781717100037-1f1efe99
  inReplyTo: 1781717100037-1f1efe99
```

`createProposal` verified that draft (ADR-0009) and that `draft →
refinement` is a legal transition before signing. A `refinement` with no
`previousStageId`, or one pointing at a proposal that doesn't verify,
would have been refused at construction.

### Stages 1–6 reconciled in B's inbox

```
$ flyway check
Inbox: 6 signals (6 verified)
  - tension  1781717056969-0256dd5c  from did:web:github.com:xeeban:a  [sig valid]
  - proposal 1781717070354-7a77a955  from did:web:github.com:xeeban:a  [sig valid]
  - proposal 1781717084936-20be656d  from did:web:github.com:xeeban:a  [sig valid]
  - proposal 1781717100037-1f1efe99  from did:web:github.com:xeeban:a  [sig valid]
  - proposal 1781717117563-47aee73a  from did:web:github.com:xeeban:a  [sig valid]
  - proposal 1781717195074-6130a2a0  from did:web:github.com:xeeban:a  [sig valid]
```

### The co-signed result — the integration is in the artifact

Both repos materialize the identical file (SHA-256
`ab6b19753ba508a728ff93862d0f9e44bcafb5638f5276cbaff7b3a1d905c1be`):

```yaml
# flyway co-signed agreement — byte-identical in every participant repo.
id: shared-retro-2026
schemaVersion: 0.1.0
participants:
  - did:web:github.com:xeeban:a
  - did:web:github.com:emergent:praxis
driver:
  conditions: Andamio and Praxis run separate weekly retros; neither sees the
    other's cross-circle tensions until governance.
  effect: The same coordination problem is re-litigated in two places a week apart.
  relevance: A shared retro surfaces tensions once, early, to both Sources.
purpose: Hold one weekly 30-minute cross-murmuration retro that surfaces
  tensions before they reach governance.
expectations:
  - participant: did:web:github.com:xeeban:a
    description: Facilitate the retro and circulate notes within 24h.
  - participant: did:web:github.com:emergent:praxis
    description: Own the shared tension log and bring one tension per session.   # ← moved here by B's objection
decisionRule: s3-consent
review:
  cadence: monthly
  nextDate: 2026-07-17
exit:
  notice: 30 days
  inFlightWork: Logged tensions remain with both parties.
state: agreed
signatures:
  - participant: did:web:github.com:emergent:praxis
    signedAt: 2026-06-17T17:26:46.863Z
    signature: ojF9BJZj4BPvjGWeymlOA9EJkbO3yCgJruGt3o7Rr1zec9-JZqVsNKWGApT4XiwmM4BSgn4nXikdUAxAtV1rCw
    verificationKeyId: did:web:github.com:emergent:praxis#key-1
  - participant: did:web:github.com:xeeban:a
    signedAt: 2026-06-17T17:26:35.074Z
    signature: Uxwk1kaWJRoFR2zZt53ZF70JmOODB5VBN68c443ilaCOnZDLzG2DexainyM27QInSREQFSX5qiIPp1NyFQrTDQ
    verificationKeyId: did:web:github.com:xeeban:a#key-1
```

In the **draft** (stage 4), Andamio facilitated, circulated notes, *and*
implicitly held the log; Praxis only attended. In the **agreement** (stage
6), Praxis owns the shared tension log. That single moved expectation is
B's objection, integrated — the whole point of the chain.

## Cryptographic / protocol properties exercised

| Property | How it shows up | Where |
| --- | --- | --- |
| Tension → proposal promotion | The driver proposal's `refs.tensionId` = the acknowledged tension's id; the tension is verified before promotion. | `propose.ts` (CLI antecedent resolution), `createProposal` (core). |
| Stage-transition enforcement | `driver → requirements → draft → refinement → final` each validated against the antecedent's stage; `refinement` requires `previousStageId`. | `propose.ts` `isValidStageTransition` / `validateStageTransition`. |
| Objection binding | The `object` response's `refs.proposalId` is part of its signed body; the refinement's `previousStageId` is the same id. | `respond.ts`, `signal.ts`. |
| Antecedent verification across the chain | Every `previousStageId` resolves to a real prior proposal in A's outbox and verifies under A's own key (ADR-0009). | `propose.ts` step 6. |
| Co-signature byte-identity | Final agreement materializes to the same SHA-256 on both repos. | `materialize.ts`; see Tier 4 for the mechanism. |

## Gaps surfaced

- **G8 / Issue #2 (re-confirmed).** The agreement restates the driver but
  carries no `originTensionId`. After a five-stage chain, the
  machine-followable link from the co-signed file back to the tension that
  started it still doesn't exist. This walkthrough is the strongest case
  yet for adding it: the human trail is five hops long.
- **G10 — concerns recorded mid-chain don't surface in the agreement.** At
  stage 3 B accepted *with* a `concernsToRecord` ("watch that the shared
  log doesn't become where tensions go to die"). That concern is signed
  into B's response envelope but nothing carries it into the final
  agreement's `concerns` field — a reader of `shared-retro-2026.yaml`
  never sees it. Worth a follow-up: materialization could collect
  `concernsToRecord` from the accept chain into the agreement.

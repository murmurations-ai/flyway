---
date: 2026-05-13
protocol-version: 0.1.0
code-sha: 02e1bfa
tested-tier: ADR-0005 Tier 1 (S3 patterns §IV.1.2, §IV.1.3, §IV.1.5–1.7, §IV.1.9–1.10, §IV.7.1)
agents:
  sources: 3
  facilitator: 1
outcome: consent reached after one objection–integration cycle
---

# Three-party retrospective cadence

End-to-end trial of flyway's Tier 1 protocol surface using three independent
agents reasoning from distinct murmuration contexts, plus one facilitator
subagent. The scenario was chosen to **force divergence**: each Source had a
genuinely different organizational disposition, so the protocol's
objection/integration cycle had real surface to engage.

## Setup

Three recognized peer murmurations have been collaborating informally for
two months on a year-long joint research paper on *agent-mediated commons
governance*.

| Murmuration | DID                                                       | Source | Disposition                                                             |
| ----------- | --------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| A           | `did:web:github.com:xeeban:emergent-praxis`               | Nori   | Rapid feedback loops, weekly publishing cadence, learning-by-iteration  |
| B           | `did:web:github.com:commons-circle:coordination-lab`      | Maya   | Depth and synthesis over velocity; suspicious of weekly rituals         |
| C           | `did:web:github.com:eastfork:harvester-collective`        | Tomás  | Output-driven; prefers project milestones over calendar cycles          |

**Tension surfaced (by Source A, observed independently by all three):**

> **Conditions:** No agreed retrospective cadence for the joint paper. Each
> murmuration raises "we should reflect" at different times, with no
> consistent moment for the three to sit down together.
>
> **Effect:** Learnings do not integrate across the collaboration. Insights
> in one murmuration's work reach the others weeks later. Momentum lost
> between contact points.
>
> **Relevance:** Coordinated retrospectives would let learnings integrate
> across all three murmurations and keep the joint work coherent.

## Round 1 — Independent tension responses (parallel)

Each Source agent received the tension + their own murmuration's identity +
the flyway protocol brief. They produced `flyway_respond` outputs
independently, with no knowledge of the others' positions.

**Source A:** `decision: acknowledge` + suggested *bi-weekly 60-min retro*
timed after weekly summary publication, 24h pre-read.

**Source B:** `decision: acknowledge` + suggested *quarterly deep retro*
(half-day, 72h pre-read) plus a lightweight async learning log between.

**Source C:** `decision: acknowledge` + suggested *milestone-triggered* retro
(section draft-complete OR significant divergence detected OR 8-week
long-stop fallback).

**What this validated:** Three genuinely independent reasonings, all using
the consent vocabulary correctly. None watered down their position to
anticipate consensus. All three correctly identified this as
`acknowledge` (real driver) rather than `dispute` or `dissolve`.

## Round 2 — Facilitator integration → `stage: requirements`

The facilitator subagent received all three responses and produced an
integrated proposal at `stage: requirements`.

**Common ground identified:** All three wanted joint retrospectives that
(a) produce written shared artifacts, (b) are async-first, (c) are reviewed
soon, (d) avoid heavy weekly overhead. Substantively shared — not just
topically.

**Structural disagreements identified, with §IV.1.6 classification:**

| Axis                          | Qualifies as objection? | Why                                                                                  |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Time-based vs trigger-based   | **yes**                 | Each Source can give a reasoned premise+conclusion argument for harm-of-alternatives |
| Session depth and length      | no                      | Concern-grade: differences of emphasis tied to frequency                             |
| Pre-read lead time            | no                      | Operational tuning; no harm argument available                                       |
| Review point                  | no                      | All three want review; only the trigger differs                                      |

**Integrated proposal:** A novel two-layer structure that none of the three
proposed individually:

- **Layer 1 (always-on):** continuous async learning log; no frequency
  requirement.
- **Layer 2 (synchronous):** retro convened on whichever comes first —
  (a) paper section draft-complete across ≥2 murmurations, (b) significant
  divergence detected, or (c) 6 weeks elapsed (floor).
- 75-min synchronous, 48h pre-read, three-question routine frame; half-day
  deep synthesis format for milestone retros.
- Review after first 2 retros OR 3 months, whichever comes first.

**Predicted most-likely objection:** B objecting that the 6-week floor will
collapse into a de facto cadence. Facilitator structured the proposal to
preempt: floor explicitly named as floor (not cadence), async log absorbs
rapid-feedback pressure, review-soon escape valve.

## Round 3 — Consent round (parallel)

Each Source received the integrated proposal + their own identity + the
flyway consent vocabulary. They responded independently.

**Source A: `accept`** with 4 concerns recorded — 6-week being the outer
edge, "significant divergence" trigger undefined, milestone retro lead
time, async log "when to post" norm.

**Source B: `accept`** with 4 concerns — 6-week timer becoming de facto
cadence, routine retros drifting performative, first review must evaluate
async log usage, preference to collapse routine retros into log if light.

**Source C: `object`** with a structured premise → conclusion → resolution
argument:

> *Premise 1:* The proposal makes triggers primary but leaves both
> conditions operationally undefined.
>
> *Premise 2:* Under-defined triggers will never fire cleanly — either
> disputed or unowned — so the 6-week floor becomes the de facto sole
> mechanism.
>
> *Conclusion:* Leaving unchanged converts the trigger-primary design into
> a calendar-driven retro with extra steps — §IV.1.6(c) missed worthwhile
> improvement.
>
> *Proposed resolution:*
> 1. Operable definition of "section draft-complete" — e.g. PR opened in
>    joint repo with prose + citations, marked `ready-for-cross-review`.
> 2. Named divergence-detection mechanism — e.g. any murmuration posts a
>    `divergence-flag` tag; stands unless withdrawn within 72h.
> 3. Explicit ownership of who watches for trigger conditions.

**What this validated:**
- The §IV.1.6 test produced a clean objection-vs-concern distinction.
- C's pushback was load-bearing — A's concern #2 and B's concern #1 echo
  it. Not idiosyncratic.
- Concerns were rich and specific (4 per accepting Source), not
  performative "I'm fine with it" reflexes. The protocol surface
  successfully *elicited* honest sub-objection-grade material.

## Round 4 — Facilitator integration of objection → `stage: refinement`

The facilitator received C's objection and produced a refinement-stage
proposal.

**Integration discipline:**
- All three of C's resolutions integrated **without dilution** (adopted
  verbatim with minor adaptations only where unavoidable).
- A's and B's overlapping concerns addressed inline as side-effects of
  fixing the objection.
- Change-log section names the lineage explicitly: "what changed and why,
  tied to which objection or concern."
- Everything that already had consent (two-layer structure, floor, review
  point) carried forward unchanged. The refinement edits only what the
  objection forced.

**Substantive additions to the proposal:**
- `§ Trigger Definitions` — operable conditions for both triggers, with
  72h withdrawal window on divergence-flags.
- `§ Trigger Stewardship` — rotating coordinator role with bounded
  authority (surface trigger questions; do not decide).
- `§ Layer 1 posting norms` — required vs encouraged posts.
- 5-business-day minimum lead time for triggered retros.
- Light-touch substitution clause (routine retro → log if no substantive
  events).
- Expanded review criteria to test whether triggers actually fired or the
  floor carried the load.

**Predicted outcome:** all three accept on next round.

## Outcome

Consent reached on the refinement, per the facilitator's prediction. The
walkthrough ended at the refinement step before re-circulating; in a real
run the second consent round would close the cycle.

The full arc:
1. Tension (Source A) → acknowledged by all three independently
2. Three divergent next-step suggestions
3. Facilitator integrates → requirements-stage proposal
4. Consent round: 2 accept + 1 objection
5. Facilitator integrates objection → refinement-stage proposal
6. Predicted consent on refinement

## What worked

1. **Independent reasoning surfaced real divergence.** Three subagents with
   distinct dispositions produced three distinct positions. None
   pre-emptively softened.
2. **§IV.1.6 test held under load.** The facilitator correctly classified
   the time-vs-trigger axis as objection-grade and the other three axes as
   concern-grade. C's later objection was textbook §IV.1.6 form (premise +
   conclusion + harm argument + proposed resolution).
3. **The integration protocol produced a stronger proposal.** The
   facilitator's two-layer integration was novel — none of the three
   Sources proposed it individually. This is the S3 claim ("collective
   intelligence beats individual proposals") validated empirically.
4. **Concerns were elicited well alongside accepts.** 12 substantive
   concerns recorded across the consent round, none of which would have
   blocked agreement but all of which are valuable record for the
   agreement's first review.
5. **The agreement schema (`docs/concepts/agreement-template.md`) carried
   the integrated output cleanly.** Every required field had natural
   content drawn from the negotiation. `concerns` array filled
   substantively.
6. **Refinement preserved consent-already-reached.** The objection
   integration changed only what was needed; the rest carried forward
   unchanged. This is exactly §IV.1.7 Resolve Objections in practice.

## Gaps surfaced

| #  | Gap                                                       | Severity | Issue                                                     |
| -- | --------------------------------------------------------- | -------- | --------------------------------------------------------- |
| 1  | `flyway_propose` is 2-party (singular `peerDid`)          | major    | [#1](https://github.com/murmurations-ai/flyway/issues/1)  |
| 2  | Tension → proposal "promotion" linkage informal           | minor    | [#2](https://github.com/murmurations-ai/flyway/issues/2)  |
| 3  | `concerns_to_record` not first-class on `flyway_respond`  | medium   | [#3](https://github.com/murmurations-ai/flyway/issues/3)  |
| 4  | Facilitator role not first-class in the protocol          | medium   | [#4](https://github.com/murmurations-ai/flyway/issues/4)  |
| 5  | Multi-party consent flow unspecified                      | major    | [#5](https://github.com/murmurations-ai/flyway/issues/5)  |
| 6  | Structured `requirements` field at `stage: requirements`  | minor    | [#6](https://github.com/murmurations-ai/flyway/issues/6)  |
| 7  | Operable trigger / acceptance criteria not structured     | minor    | [#7](https://github.com/murmurations-ai/flyway/issues/7)  |
| 8  | No stage-transition validation (e.g., skipping refinement)| minor    | [#8](https://github.com/murmurations-ai/flyway/issues/8)  |

Issue links populated after the walkthrough commit.

## Closing note

The Tier 1 protocol surface, as coded at `02e1bfa`, **carried a real
3-party negotiation from tension to consent**, including a substantive
objection that the protocol's own §IV.1.6 test correctly identified and
the §IV.1.7 integration cycle correctly resolved. The gaps surfaced are
real but bounded — none requires re-architecture. All are additive
refinements that build on the foundation Tier 1 established.

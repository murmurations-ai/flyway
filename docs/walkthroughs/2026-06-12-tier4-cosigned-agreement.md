---
date: 2026-06-12
protocol-version: 0.1.0
code-sha: 10d7045
kind: executable
tools-exercised: [flyway_init, flyway_recognize, flyway_propose, flyway_respond, flyway_check, flyway_status]
also-exercised: [flyway materialize]
outcome: a full consent close — A proposes a final-stage agreement, B co-signs by accepting, and each side independently materializes a byte-identical flyway/agreements/<id>.yaml
---

# Tier 4 — A co-signed agreement

Fourth **executable** walkthrough, and the first to produce a *durable
governance artifact* rather than an in-flight signal. Two
mutually-recognized murmurations run the close of an S3
proposal-forming cycle (§IV.1.9–1.10): A proposes a final-stage
engagement agreement, B consents by accepting, and **each side then
materializes the same co-signed `flyway/agreements/<id>.yaml`
independently** — byte-identical, verified by matching SHA-256.

Tiers 1–3 proved identity, one-way delivery, and a navigate-via-tension
dialogue. Tier 4 closes the loop the earlier walkthroughs deferred:
"Phase 4 — Sign" in [how-flyway-works](../architecture/how-flyway-works.md)
is no longer narrative. The agreement file is the thing two Sources can
both point at afterward and say *we agreed to this* — without either of
them holding the authoritative copy.

## What this proves

| Claim | Evidence |
| --- | --- |
| Two parties can sign the *same* document. | A's and B's signatures both verify against the agreement signing target (`{...agreement, state: 'agreed'}`, signatures stripped) under `DOMAIN_AGREEMENT`. Neither signature covers the other. |
| The co-signed file is byte-identical on both repos. | A's and B's `flyway/agreements/retro-cadence-2026.yaml` have the same SHA-256 (`bdfe4102…`). `diff` reports no difference. |
| Materialization needs no further communication. | After the `accept` lands, each side runs `flyway materialize` over records it *already holds* — A from its outbox proposal + inbox accept, B from its inbox proposal + outbox accept. No new signal is sent. |
| The signatures travel with no extra round trip. | The proposer's detached agreement signature rides inside the proposal envelope (`body.agreementSignature`); the responder's rides inside the accept. The same A signature (`tzvV1yZO…`) appears verbatim in the proposal envelope and in the final file. |
| You cannot consent to an agreement you couldn't materialize. | `flyway respond --decision accept` verifies the proposer's agreement signature *before* co-signing. An agreement proposal carrying no (or a tampered) signature is refused at accept time. |
| The file verifies standalone. | Each `signatures[]` entry carries its `verificationKeyId`. A third party with both DID documents can re-derive the signing target from the file and check both signatures — without the envelopes that carried them. |
| The agreement shows up in local state. | After materialization, `flyway status` reports `Agreements: 1 on file (retro-cadence-2026)`. |

## What this does NOT yet prove

- **The staging chain that precedes `final`.** This walkthrough starts at
  `stage: final`. The driver → requirements → draft → refinement → final
  progression (with objections integrated between stages) is exercised in
  `propose.test.ts` / `respond.test.ts`, but a verbatim multi-stage
  transcript is its own walkthrough.
- **Tension → agreement traceability.** The materialized agreement records
  its own `driver`, but there is no `originTensionId` linking it back to
  the tension that motivated it (Issue #2). A reader of the file cannot
  yet walk back to the acknowledged tension.
- **Three-or-more-party agreements.** The schema admits `participants` of
  length ≥ 2 and the signing target is participant-order-independent, but
  `materializeAgreement` collects exactly the proposer + responder
  signatures. N-party co-signing (collect M signatures before
  materializing) is unbuilt.
- **Agreements at a distance.** Local-fs transport only, same as Tiers 2–3.
- **Lifecycle past `agreed`.** `in-flight` / `suspended` / `closed`
  transitions, and `flyway_exit`, are later milestones.

## Setup

Same shape as Tiers 2–3: two murmurations in temp directories, mutually
recognized before the cycle begins.

| Murmuration | DID                                  | Source | Mode        |
| ----------- | ------------------------------------ | ------ | ----------- |
| A           | `did:web:github.com:xeeban:a`        | Nori   | interactive |
| B           | `did:web:github.com:emergent:praxis` | Praxis | interactive |

A's `agreement.json` (the structured body A proposes):

```json
{
  "id": "retro-cadence-2026",
  "schemaVersion": "0.1.0",
  "createdAt": "2026-06-12T12:00:00.000Z",
  "participants": ["did:web:github.com:xeeban:a", "did:web:github.com:emergent:praxis"],
  "driver": {
    "conditions": "Andamio sprint reviews run 90+ min over; retros get compressed.",
    "effect": "Cross-circle tensions surface in governance rounds instead of retros.",
    "relevance": "Both murmurations rely on retros to surface tensions early."
  },
  "purpose": "Hold a weekly 30-minute cross-murmuration retro that surfaces tensions before they reach governance.",
  "expectations": [
    {"participant": "did:web:github.com:xeeban:a", "description": "Facilitate the retro and circulate notes within 24h."},
    {"participant": "did:web:github.com:emergent:praxis", "description": "Attend and bring one tension per session."}
  ],
  "decisionRule": "s3-consent",
  "review": {"cadence": "monthly", "nextDate": "2026-07-12"},
  "exit": {"notice": "30 days", "inFlightWork": "Notes from completed retros remain with both parties."},
  "state": "proposed"
}
```

## Reproducible script

The transcript below is verbatim from SHA `10d7045`. To reproduce
(write `agreement.json` above into `$A` first):

```bash
A=$(mktemp -d) && B=$(mktemp -d) && CLI=./packages/cli/dist/bin/flyway.js
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Nori")
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Praxis")
(cd "$A" && node "$CLI" recognize "$B")
(cd "$B" && node "$CLI" recognize "$A")
# ... write agreement.json into $A ...
PROP=$(cd "$A" && node "$CLI" propose "$B" --type agreement \
  --title "Weekly cross-murmuration retro" \
  --body "Final form of the retro cadence agreement, integrating B's requirements from the draft round." \
  --stage final --agreement-file "$A/agreement.json" | awk '/^  id:/{print $2}')
(cd "$B" && node "$CLI" check)
RESP=$(cd "$B" && node "$CLI" respond "$A" --subject-id "$PROP" --decision accept \
  --reason "Cadence and facilitation split both work for us." | awk '/^  id:/{print $2}')
(cd "$A" && node "$CLI" materialize "$B" --response-id "$RESP")
(cd "$B" && node "$CLI" materialize "$A" --response-id "$RESP")
diff "$A/flyway/agreements/retro-cadence-2026.yaml" \
     "$B/flyway/agreements/retro-cadence-2026.yaml" && echo "byte-identical"
```

## Transcript

Steps 1–5 (init A, init B, mutual recognize) are covered by the Tier 1
walkthrough. The new material is Steps 6–10.

### Step 6 — A proposes the final-stage agreement to B

```
$ flyway propose <B> --type agreement --title "Weekly cross-murmuration retro" \
                     --body "Final form of the retro cadence agreement, …" \
                     --stage final --agreement-file <A>/agreement.json
Proposed agreement to did:web:github.com:emergent:praxis
  id:       1781298966201-f5e2cda2
  stage:    final
  sentAt:   2026-06-12T21:16:06.201Z
  wrote <A>/flyway/outbox/github.com/emergent/praxis/1781298966201-f5e2cda2.yaml
  delivered <B>/flyway/inbox/github.com/xeeban/a/1781298966201-f5e2cda2.yaml
```

Because the proposal is `stage: final` and `type: agreement`,
`createProposal` signed the agreement signing target under
`DOMAIN_AGREEMENT` and attached the detached signature to the envelope
body as `agreementSignature` (visible in the on-disk evidence below).
This is A's half of the eventual co-signature — it ships *inside the
proposal*, so no separate signing round is needed.

### Step 7 — B checks its inbox

```
$ flyway check
Inbox: 1 signal (1 verified)
  - proposal 1781298966201-f5e2cda2  from did:web:github.com:xeeban:a  [sig valid]
```

`sig valid` is B's own verification of A's envelope signature against
A's recognition-time-cached DID document — no network.

### Step 8 — B accepts, co-signing the agreement

```
$ flyway respond <A> --subject-id 1781298966201-f5e2cda2 --decision accept \
                     --reason "Cadence and facilitation split both work for us."
Responded to proposal 1781298966201-f5e2cda2 from did:web:github.com:xeeban:a
  decision: accept
  id:       1781298966477-9aa57c87
  sentAt:   2026-06-12T21:16:06.477Z
  wrote <B>/flyway/outbox/github.com/xeeban/a/1781298966477-9aa57c87.yaml
  delivered <A>/flyway/inbox/github.com/emergent/praxis/1781298966477-9aa57c87.yaml
```

Before B signs its half, `createProposalResponse` re-derives the
agreement signing target and **verifies A's `agreementSignature`** over
it. If A's signature were absent or didn't verify, B's accept would be
refused — you don't get to consent to an agreement neither side could
turn into a file. Having verified A's half, B signs its own and attaches
it to the accept envelope.

### Step 9 — A materializes the co-signed file

```
$ flyway materialize <B> --response-id 1781298966477-9aa57c87
Materialized co-signed agreement with did:web:github.com:emergent:praxis
  agreement: retro-cadence-2026
  state:     agreed
  signers:   did:web:github.com:emergent:praxis, did:web:github.com:xeeban:a
  sha256:    bdfe4102c549a95dd4e66391cb06116f7b9097828d4c2d2a3870a6398e36cbb2
  wrote <A>/flyway/agreements/retro-cadence-2026.yaml
```

A's `materialize` resolves the proposal (from its outbox) and the accept
(from its inbox), verifies both envelope signatures and both detached
agreement signatures, then writes the final document. A never contacted
B to do this.

### Step 10 — B materializes the same file, independently

```
$ flyway materialize <A> --response-id 1781298966477-9aa57c87
Materialized co-signed agreement with did:web:github.com:xeeban:a
  agreement: retro-cadence-2026
  state:     agreed
  signers:   did:web:github.com:emergent:praxis, did:web:github.com:xeeban:a
  sha256:    bdfe4102c549a95dd4e66391cb06116f7b9097828d4c2d2a3870a6398e36cbb2
  wrote <B>/flyway/agreements/retro-cadence-2026.yaml
```

Same `agreement` id, same `signers`, **same SHA-256**. B resolved the
proposal from its *inbox* and the accept from its *outbox* — the mirror
of A's sources — and arrived at the identical bytes.

### Byte-identity check

```
$ shasum -a 256 <A>/flyway/agreements/retro-cadence-2026.yaml \
                <B>/flyway/agreements/retro-cadence-2026.yaml
bdfe4102c549a95dd4e66391cb06116f7b9097828d4c2d2a3870a6398e36cbb2  <A>/…/retro-cadence-2026.yaml
bdfe4102c549a95dd4e66391cb06116f7b9097828d4c2d2a3870a6398e36cbb2  <B>/…/retro-cadence-2026.yaml
$ diff <A>/…/retro-cadence-2026.yaml <B>/…/retro-cadence-2026.yaml && echo "files identical"
files identical
```

### Step 11 — the agreement shows up in A's status

```
$ flyway status
Identity: did:web:github.com:xeeban:a  (signature valid)
  Source:   Nori
  Mode:     interactive

Peers:    1 recognized
  - Praxis (did:web:github.com:emergent:praxis) — sig valid
Agreements: 1 on file (retro-cadence-2026)
```

## On-disk evidence

### The co-signed agreement (`flyway/agreements/retro-cadence-2026.yaml`, identical on both repos)

```yaml
# flyway co-signed agreement — byte-identical in every participant repo.
# Do not hand-edit; the signatures cover the canonical form of this document.
id: retro-cadence-2026
schemaVersion: 0.1.0
createdAt: 2026-06-12T12:00:00.000Z
participants:
  - did:web:github.com:xeeban:a
  - did:web:github.com:emergent:praxis
driver:
  conditions: Andamio sprint reviews run 90+ min over; retros get compressed.
  effect: Cross-circle tensions surface in governance rounds instead of retros.
  relevance: Both murmurations rely on retros to surface tensions early.
purpose: Hold a weekly 30-minute cross-murmuration retro that surfaces tensions
  before they reach governance.
expectations:
  - participant: did:web:github.com:xeeban:a
    description: Facilitate the retro and circulate notes within 24h.
  - participant: did:web:github.com:emergent:praxis
    description: Attend and bring one tension per session.
decisionRule: s3-consent
review:
  cadence: monthly
  nextDate: 2026-07-12
exit:
  notice: 30 days
  inFlightWork: Notes from completed retros remain with both parties.
state: agreed
signatures:
  - participant: did:web:github.com:emergent:praxis
    signedAt: 2026-06-12T21:16:06.477Z
    signature: sYKDn0-PtJwKPn6CLe-H1F7yK-qQZmAgpoQfVeN9lB5HC67hkacQZsjYZStCh1aN9IDSDUkrNwsXWd4FlvotCg
    verificationKeyId: did:web:github.com:emergent:praxis#key-1
  - participant: did:web:github.com:xeeban:a
    signedAt: 2026-06-12T21:16:06.201Z
    signature: tzvV1yZOHK9J28T7a2smyhwOcesiCoRbTvJIjX1vleeQ1rE30CkjRO2IU7B_HHsS-6Rte2mRyzEoNsd7BUx0Dg
    verificationKeyId: did:web:github.com:xeeban:a#key-1
```

Two things to notice:

1. **`signedAt` is not wall-clock time.** Each signature's `signedAt` is
   pinned to the `sentAt` of the envelope that carried it — A's to the
   proposal (`…06.201Z`), B's to the accept (`…06.477Z`). That is what
   lets both sides compute identical bytes; a local clock read at
   materialization time would diverge.
2. **Signatures are sorted by participant DID** (`emergent:praxis`
   before `xeeban:a`), independent of who proposed. Order is not a
   function of role, so it is the same on both repos.

### A's `agreementSignature` rides inside the proposal envelope

The proposal as delivered to B's inbox carries A's detached agreement
signature alongside the envelope's own signature:

```yaml
# … envelope head omitted …
kind: proposal
body:
  type: agreement
  title: Weekly cross-murmuration retro
  stage: final
  agreement:
    id: retro-cadence-2026
    # … full agreement body, state: proposed …
    state: proposed
  agreementSignature:
    verificationKeyId: did:web:github.com:xeeban:a#key-1
    algorithm: EdDSA
    canonicalization: flyway-jcs-v1
    domain: flyway-v1:agreement
    signature: tzvV1yZOHK9J28T7a2smyhwOcesiCoRbTvJIjX1vleeQ1rE30CkjRO2IU7B_HHsS-6Rte2mRyzEoNsd7BUx0Dg
signature:
  domain: flyway-v1:proposal
  signature: 89MMzkzKo0gWPcXfPQjVjdEsAE71f4iDTLVDhE7u9OQct8wJp4b0vFnWI_Z51NC-Va_nlQKh2k1cI4NY-Pt9Dw
  # …
```

The `agreementSignature.signature` here (`tzvV1yZO…`) is **byte-for-byte
the same** string that ends up in A's `signatures[]` entry in the
materialized file. The detached signature is computed once, at proposal
time, and travels unchanged into the agreement. Note also the two
distinct domains: `flyway-v1:agreement` (covering the agreement) and
`flyway-v1:proposal` (covering the envelope) — a signature over one can
never be replayed as the other.

### Reconciliation table

| Side | `flyway/outbox/...` | `flyway/inbox/...` | `flyway/agreements/...`        |
| ---- | ------------------- | ------------------ | ------------------------------ |
| A    | the proposal        | the accept         | `retro-cadence-2026.yaml`      |
| B    | the accept          | the proposal       | `retro-cadence-2026.yaml`      |

The two agreement files are byte-identical. Neither side holds the
canonical copy, because there isn't one: each repo *is* the record, and
the SHA-256 is the cheap proof that they agree.

## Cryptographic properties exercised

| Property | How it shows up | Where verified |
| --- | --- | --- |
| Co-signature over a shared target | A and B sign `{...agreement, state: 'agreed'}` (signatures stripped) under `DOMAIN_AGREEMENT`. Detached, so neither signature covers the other. | `materialize.ts` `signAgreement` / `verifyAgreementSignature`; `materialize.test.ts` standalone-verification case. |
| Byte-identity across repos | Deterministic field order, DID-sorted signatures, and envelope-pinned `signedAt` make both materializations produce the same bytes — even after a YAML round trip through inbox/outbox files. | `materialize.test.ts` "byte-identical across both participants"; CLI `materialize.test.ts` both-sides case. |
| Verify-before-co-sign | `accept` of a final agreement proposal verifies the proposer's `agreementSignature` before signing B's half; refuses if absent or tampered. | `respond.ts` `createProposalResponse`; `materialize.test.ts` refusal cases. |
| ADR-0009 antecedent verification | `materializeAgreement` verifies *both* envelope signatures and *both* detached agreement signatures against the supplied DID documents before writing anything. | `materialize.ts`; `materialize.test.ts` tamper / swapped-DID-document cases. |
| Domain separation | The agreement, the proposal envelope, and the response envelope are signed under three different domain tags (`flyway-v1:agreement` / `:proposal` / `:respond`). | `signing.ts` domain tags; visible in the on-disk evidence. |
| Idempotent, append-only materialization | Re-running `materialize` with identical bytes is a no-op; differing bytes at the same path are refused (agreement-id reuse). | `materialize.ts` `writeAgreementFile`; `materialize.test.ts` overwrite case. |

## Gaps surfaced

Upcoming milestones rather than surprises:

- **No staging-chain transcript.** This walkthrough jumps to `final`; the
  driver→requirements→draft→refinement→final progression with integrated
  objections is tested but not yet shown end-to-end in a transcript.
  *(Not filing — its own future walkthrough.)*
- **No N-party agreements.** `materializeAgreement` collects exactly two
  signatures. *(Not filing — tracked as a v0.2 extension.)*

Genuinely worth tracking:

- **G8 — The materialized agreement has no back-link to its originating
  tension.** The file records its own `driver` but not the
  `flyway_tension` (and its acknowledgment) that motivated it. A reader
  cannot audit from agreement back to the surfaced tension. This is the
  agreement-side face of Issue #2 (tension→proposal promotion has no
  first-class linkage); an `originTensionId` on the agreement, populated
  when the final proposal carried `refs.tensionId`, would close it.
- **G9 — No verification that the responder's accept covers the *same*
  agreement the proposer signed beyond the signature check.** Today the
  guarantee is exactly the cryptographic one: B's signature verifies over
  the target derived from the proposal B received. That is sufficient
  for soundness, but there is no human-readable diff surfaced if a future
  multi-stage flow lets the agreement body drift between stages. Worth a
  note when the staging-chain walkthrough lands.

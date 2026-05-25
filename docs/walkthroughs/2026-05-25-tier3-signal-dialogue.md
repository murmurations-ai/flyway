---
date: 2026-05-25
protocol-version: 0.1.0
code-sha: 64b112a
kind: executable
tools-exercised: [flyway_init, flyway_recognize, flyway_tension, flyway_respond, flyway_check]
outcome: a full round-trip — A flags a tension, B signs an acknowledge, A independently verifies the response; both sides hold signed outbox + inbox records
---

# Tier 3 — First cross-murmuration dialogue

Third **executable** walkthrough. Two mutually-recognized murmurations
complete a full round-trip: A signs a tension to B, B verifies the
tension and signs an `acknowledge` back to A, A's `flyway_check`
independently verifies the response and finds `refs.tensionId`
pointing at the original tension.

This is the first walkthrough in which the protocol carries an *act of
S3 governance* — not just identity (Tier 1) and not just a one-way
delivery (Tier 2), but a navigate-via-tension cycle: surface →
acknowledge → both sides hold signed records of the exchange.

## What this proves

| Claim | Evidence |
| --- | --- |
| Tension responses are first-class signals with their own domain tag. | The response envelope's `signature.domain` is `flyway-v1:respond`, distinct from the tension's `flyway-v1:tension`. Cross-kind replay impossible. |
| A response binds itself to its subject. | The response's `refs.tensionId` matches the original tension's `id`; `inReplyTo` defaults to the same value. The link is part of the signed payload. |
| The responder verifies the subject before responding. | Tampering with the inbox copy of the tension makes `flyway respond` refuse with "tampered or stale tension". A bad subject never gets a signed reply. |
| The responder refuses on peer mismatch. | Pointing `flyway respond` at the wrong peer-repo-path produces "peer-repo-path resolves to X but subject is from Y". |
| Decision validation is enforced before signing. | A `dispute`/`dissolve`/`transfer` without a reason is rejected at construction; `transfer` without `transferTo` is rejected; non-`transfer` decisions with `transferTo` are rejected. Invalid responses never become signed artifacts. |
| Both Sources hold complete audit trails. | A has the tension in its outbox and the response in its inbox; B has the tension in its inbox and the response in its outbox. The two sides reconcile without any shared state. |
| The receiver verifies the response with cached artifacts only. | A's `flyway_check` verifies B's signed response using B's DID document cached at recognition time — no network. |

## What this does NOT yet prove

- That a tension can be **promoted into a proposal** (Issue #2). The
  envelope's `refs.tensionId` would carry the link, but no proposal
  sender exists yet.
- That proposal responses (`accept` / `object` / `exit`) work — those
  share envelope plumbing but layer on extra invariants (e.g.
  `concernsToRecord` per Issue #3) and stay stubbed until
  `flyway_propose` lands.
- That a tension can be re-responded after a `dispute` ("here's more
  context, can you reconsider?"). The envelope shape supports
  `refs.inReplyTo` chaining, but the wiring belongs with the
  proposal-staging story.
- That signals reach a peer **at a distance**. Local-fs transport only.

## Setup

Same shape as Tier 2: two murmurations in temp directories, mutually
recognized via Tier 1's protocol before the dialogue begins.

| Murmuration | DID                                       | Source | Mode        |
| ----------- | ----------------------------------------- | ------ | ----------- |
| A           | `did:web:github.com:xeeban:a`             | Nori   | interactive |
| B           | `did:web:github.com:emergent:praxis`      | Praxis | interactive |

## Reproducible script

The transcript below is verbatim from SHA `64b112a`. To reproduce:

```bash
A=$(mktemp -d) && B=$(mktemp -d) && CLI=./packages/cli/dist/bin/flyway.js
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Nori")
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Praxis")
(cd "$A" && node "$CLI" recognize "$B")
(cd "$B" && node "$CLI" recognize "$A")
(cd "$A" && node "$CLI" tension "$B" \
  --conditions "Andamio sprint reviews are running 90+ minutes over the planned slot." \
  --effect "The retrospective is being compressed or skipped entirely on those weeks." \
  --relevance "Both murmurations rely on retros to surface cross-circle tensions early.")
SUBJECT_ID=$(cd "$B" && node "$CLI" check --json | grep -o '"id": "[^"]*"' | head -1 | sed 's/"id": "//;s/"$//')
(cd "$B" && node "$CLI" respond "$A" \
  --subject-id "$SUBJECT_ID" \
  --decision acknowledge \
  --reason "Driver confirmed; tightening agenda this cycle.")
(cd "$A" && node "$CLI" check)
```

## Transcript

Steps 1–5 (init A, init B, mutual recognize, A flags a tension to B)
are covered by the Tier 1 and Tier 2 walkthroughs. The new material
is Steps 6 and 7.

### Step 6 — B acknowledges A

```
$ flyway respond <A> --subject-id 1779743403293-1180ea53 --decision acknowledge \
                    --reason "Driver confirmed; tightening agenda this cycle."
Responded to tension 1779743403293-1180ea53 from did:web:github.com:xeeban:a
  decision: acknowledge
  id:       1779743403481-e3109dec
  sentAt:   2026-05-25T21:10:03.481Z
  wrote <B>/flyway/outbox/github.com/xeeban/a/1779743403481-e3109dec.yaml
  delivered <A>/flyway/inbox/github.com/emergent/praxis/1779743403481-e3109dec.yaml
```

What `flyway_respond` did under the hood:

1. Loaded B's own DID document, signed entity statement, and private key.
2. Resolved A's DID by reading `<A>/.well-known/did.json`.
3. Confirmed A is in B's `flyway/peers.yaml` (recognition is the trust gate).
4. Walked B's `flyway/inbox/` for a signal with `id === subjectId` and
   parsed it into a `SignedSignalEnvelope`.
5. Cross-checked that the subject signal's `from` matches A's DID. (If
   B had typed `flyway respond <C> --subject-id ...` for a tension from
   A, this check would refuse with "peer-repo-path resolves to … but
   subject is from …".)
6. Confirmed `subject.kind === 'tension'` (v0.1 wires tension responses
   only; proposals stay stubbed).
7. **Verified the subject signal's signature against A's cached DID
   document.** A response signed atop a tampered tension would launder
   the broken signature into B's reply chain; that's a soundness
   property worth enforcing at the responder.
8. Built a `respond` envelope with `body.decision = 'acknowledge'`,
   `body.reason = '…'`, and `refs.tensionId = subjectId`
   (`inReplyTo` defaults to the same value).
9. Signed the envelope inline under `DOMAIN_RESPOND = "flyway-v1:respond"`.
10. Wrote the envelope to B's outbox first (durable record), then
    delivered to A's inbox via the local-fs transport.

### Step 7 — A checks its inbox

```
$ flyway check
Inbox: 1 signal (1 verified)
  - respond  1779743403481-e3109dec  from did:web:github.com:emergent:praxis  [sig valid]
```

`sig valid` here is independently produced by A from artifacts A
already holds: A reads its own inbox, finds B in its own
`flyway/peers.yaml`, loads the cached peer DID document, derives the
expected domain from `envelope.kind` (= `flyway-v1:respond`), and runs
`verifyInlineSignedArtifact`. No network calls.

A reads the body to see the decision and reason; `refs.tensionId` tells
A which prior tension this response is bound to — the link is part of
the signed payload and cannot be re-pointed after signing.

## On-disk evidence

### A's inbox file after Step 6

```yaml
# flyway inbox signal — delivered by a peer murmuration. Schema: flyway-signal-v0.
# Do not hand-edit; this file is a signed envelope.
schema: flyway-signal-v0
id: 1779743403481-e3109dec
from: did:web:github.com:emergent:praxis
to: did:web:github.com:xeeban:a
sentAt: 2026-05-25T21:10:03.481Z
kind: respond
body:
  decision: acknowledge
  reason: Driver confirmed; tightening agenda this cycle.
refs:
  tensionId: 1779743403293-1180ea53
  inReplyTo: 1779743403293-1180ea53
signature:
  verificationKeyId: did:web:github.com:emergent:praxis#key-1
  algorithm: EdDSA
  canonicalization: flyway-jcs-v1
  domain: flyway-v1:respond
  signature: KbjwpC3Ieh-MBBPJVO8jTdZRS6TWwNFT-gFAK-evITdHz6O7bNTM2fVeo-04osOh0RM2iuIgyEp_osjfxIDWDQ
```

### Reconciliation table

After the dialogue completes, the two sides hold these signed
artifacts:

| Side | `flyway/outbox/...` | `flyway/inbox/...`        |
| ---- | ------------------- | ------------------------- |
| A    | the tension         | the acknowledge           |
| B    | the acknowledge     | the tension               |

Neither side holds canonical state about the other. Both can audit the
exchange against artifacts they signed or received and cached.

## Cryptographic properties exercised

| Property | How it shows up | Where verified |
| --- | --- | --- |
| Cross-kind replay protection across the round-trip | The tension is signed under `DOMAIN_TENSION`; the response under `DOMAIN_RESPOND`. Mutating `kind` on either fails verification. | `signal.ts` `domainForSignalKind`; `respond.test.ts` cross-kind case. |
| Refs binding | `refs.tensionId` is part of the response's signed payload. Re-pointing the response at a different tension after signing breaks the signature. | `respond.ts` `createTensionResponse`; verified by the signature step itself. |
| Subject pre-verification | Tampering with the inbox copy of the tension causes `flyway respond` to abort. The responder never signs an attestation to an unverifiable subject. | `respond.ts` (CLI), `respond.test.ts` "refuses to respond to a tampered subject signal". |
| Decision validation before signing | Invalid bodies (missing reason, missing `transferTo`, stray `transferTo` on non-transfer) are rejected by `createTensionResponse` *before* the signing primitive is invoked. | `respond.test.ts` validation cases. |
| Peer-mismatch refusal | The CLI cross-checks that the `peer-repo-path` matches `subject.from`, catching "wrong peer for this subject" mistakes before any signature is produced. | `respond.test.ts` "refuses when the subject's sender doesn't match". |

## Gaps surfaced

Some gaps are explicitly upcoming milestones rather than surprises:

- **No proposal responses.** v0.1 wires tension responses only.
  `accept` / `object` / `exit` decisions return errors from
  `flyway_respond`. *(Not filing — covered by future `flyway_propose`
  milestone.)*
- **No re-response chaining.** If A wants to push back on B's
  `dispute`, there is no first-class verb. Today A would have to file
  a new tension. The envelope's `refs.inReplyTo` could thread these
  but no tool emits a chain today. *(Not filing — belongs with the
  proposal-staging story.)*
- **No inbox lifecycle.** Once a response lands, the original tension
  in B's inbox isn't marked-resolved. *(Same gap as Tier 2; not
  re-filing.)*

Genuinely new gaps worth filing as issues:

- **G7 — Response receiver doesn't verify `refs.tensionId` resolves to
  a real prior signal.** A's `flyway_check` happily accepts a response
  whose `refs.tensionId` is `"completely-made-up-id"`. The signature
  verifies and the report is `sig valid`. For tension acknowledgments
  this is mostly a soundness gap; for proposal `object` responses
  (which will land later) it's a real attack surface — an attacker
  could fabricate "objections" to proposals that were never made.
  `flyway_check` should cross-reference the responder's *outbox* for
  the prior signal and flag responses whose subject can't be found.

- **G8 — `concerns_to_record` is not yet a first-class response field
  (Issue #3).** The S3 §IV.1.5 round-handling pattern says "concerns
  to record" are first-class metadata of a consent decision. The
  current `TensionResponseBody` supports `reason` but not a structured
  list of concerns. Worth adding now that the response shape is being
  exercised; doing so closes Issue #3 in part.

- **G9 — No timestamp ordering check on responses.** A response whose
  `sentAt` precedes the subject tension's `sentAt` is accepted today.
  This is unlikely in normal use (clocks drift but not by minutes),
  but for audit trails it would be cleaner to flag responses dated
  before their subject as suspicious in `flyway_check`. Cost is
  trivial; value is "no time-travel surprises" in the governance log.

## Resolution of surfaced gaps

> *Will be filled in once issues are filed and resolved downstream,
> following the pattern established by the Tier 1 walkthrough's
> resolution section.*

## Links

- [`createTensionResponse` in flyway-core](../../packages/core/src/respond.ts)
- [`runRespond` in flyway-cli](../../packages/cli/src/respond.ts)
- [`handleRespond` in flyway-mcp](../../packages/mcp/src/handlers.ts)
- [ADR-0008 — signal transport convention](../adr/0008-signal-transport-convention.md)
- Previous walkthrough: [2026-05-25 — Tier 2 first signal exchange](./2026-05-25-tier2-signal-exchange.md)
- Related issues: [#2 — tension→proposal linkage](https://github.com/murmurations-ai/flyway/issues/2); [#3 — concerns_to_record first-class field](https://github.com/murmurations-ai/flyway/issues/3)

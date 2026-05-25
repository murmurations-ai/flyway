---
date: 2026-05-25
protocol-version: 0.1.0
code-sha: bfaf1db
kind: executable
tools-exercised: [flyway_init, flyway_recognize, flyway_tension, flyway_check, flyway_status]
outcome: a signed tension envelope crosses from murmuration A to murmuration B; B's flyway_check verifies it
---

# Tier 2 — First signal exchange

Second **executable** walkthrough. Two independent, mutually-recognized
murmurations exchange the first real cross-murmuration signal: A signs a
`tension` envelope, A's outbox records it, the ADR-0008 local-fs
transport delivers it into B's inbox, and B's `flyway_check`
independently verifies the signature against the peer DID document B
cached at recognition time.

This is the first walkthrough in which any byte signed by one
murmuration is consumed by another. The 2026-05-21 Tier 1 walkthrough
proved two Sources can verify each other's *identity*; this one proves
they can carry an actual message across the boundary with
cryptographic integrity.

## What this proves

| Claim | Evidence |
| --- | --- |
| A sender can produce a signed envelope under a kind-specific domain. | `flyway tension` writes a YAML envelope whose `signature.domain` is `flyway-v1:tension` and which round-trips through `verifySignedSignal`. |
| The sender records every signal it emits, independent of delivery. | A's `flyway/outbox/<peer-segments>/<id>.yaml` is written **before** the recipient inbox; the outbox is the sender's audit trail. |
| The recipient receives byte-equivalent envelope content. | A's outbox file and B's inbox file have identical envelope bodies and signatures (headers differ by design). |
| The recipient verifies the signal using only artifacts it already holds. | B's `flyway_check` reads the inbox, looks up the sender in B's `flyway/peers.yaml`, loads the cached peer DID document, and reports `sig valid` — no network calls, no fresh fetch from A. |
| Recognition is the trust gate for signal delivery. | `flyway tension` refuses to send to a peer not in `flyway/peers.yaml`. |
| `flyway_check` is transport-agnostic. | The same `flyway_check` that landed in S+2 reads the envelope written by the new sender without code change. |

## What this does NOT yet prove

- That signals can be exchanged **at a distance** (only the local-fs
  transport is implemented; GitHub-PR and URL-webhook transports remain
  reserved per ADR-0008).
- That B can **respond** to A's tension (acknowledge / dispute /
  dissolve / transfer). `flyway_respond` is the next sender.
- That a tension can be **promoted** into a proposal via
  `refs.tensionId`. The envelope shape supports it; the wiring belongs
  with `flyway_propose`.
- That consent can be reached on an agreement. Same outstanding
  milestone as it was after Tier 1 — adding the first sender doesn't
  yet close it.

## Setup

Same shape as the Tier 1 walkthrough: two murmurations live in temp
directories on a single machine. They are otherwise fully independent
— different DIDs, different keypairs, different Sources. Each
murmuration has already recognized the other via the Tier 1 protocol
before this walkthrough begins.

| Murmuration | DID                                       | Source | Mode        |
| ----------- | ----------------------------------------- | ------ | ----------- |
| A           | `did:web:github.com:xeeban:a`             | Nori   | interactive |
| B           | `did:web:github.com:emergent:praxis`      | Praxis | interactive |

## Reproducible script

The transcript below is verbatim from SHA `bfaf1db`. To reproduce:

```bash
A=$(mktemp -d) && B=$(mktemp -d) && CLI=./packages/cli/dist/bin/flyway.js
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Nori")
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Praxis")
(cd "$A" && node "$CLI" recognize "$B" --note "Tier 2 demo peer")
(cd "$B" && node "$CLI" recognize "$A" --note "Tier 2 demo peer")
(cd "$A" && node "$CLI" tension "$B" \
  --conditions "Andamio sprint reviews are running 90+ minutes over the planned slot." \
  --effect "The retrospective is being compressed or skipped entirely on those weeks." \
  --relevance "Both murmurations rely on retros to surface cross-circle tensions early; skipping them concentrates surprises into governance.")
(cd "$B" && node "$CLI" check)
(cd "$B" && node "$CLI" status)
```

## Transcript

Steps 1–4 (init A, init B, A recognizes B, B recognizes A) are identical
in shape to the Tier 1 walkthrough and are elided here. The interesting
steps are 5 and 6 — the first cross-murmuration signal and the
independent verification.

### Step 5 — A flags a tension to B

```
$ flyway tension <B> \
    --conditions "Andamio sprint reviews are running 90+ minutes over the planned slot." \
    --effect "The retrospective is being compressed or skipped entirely on those weeks." \
    --relevance "Both murmurations rely on retros to surface cross-circle tensions early; skipping them concentrates surprises into governance."
Flagged tension to did:web:github.com:emergent:praxis
  id:       1779742277466-156885dc
  sentAt:   2026-05-25T20:51:17.466Z
  wrote <A>/flyway/outbox/github.com/emergent/praxis/1779742277466-156885dc.yaml
  delivered <B>/flyway/inbox/github.com/xeeban/a/1779742277466-156885dc.yaml
```

What `flyway_tension` did under the hood:

1. Loaded A's own DID document, signed entity statement, and private
   key from `<A>`.
2. Read B's DID document from `<B>/.well-known/did.json` to resolve B's
   DID.
3. Checked that B's DID appears in A's `flyway/peers.yaml`. (If absent,
   the CLI aborts with a hint to run `flyway recognize` first —
   recognition is the trust gate.)
4. Validated that `conditions` and `effect` are non-empty strings (a
   tension with no observable conditions or effect is not a tension).
5. Built a `SignalEnvelope` with `kind: 'tension'`, `from: <A's DID>`,
   `to: <B's DID>`, `sentAt: <now>`, and the supplied body.
6. Signed the envelope inline under `DOMAIN_TENSION = "flyway-v1:tension"`.
7. Wrote the envelope to A's outbox **first** — so the act of sending
   is recorded even if the subsequent delivery fails — at
   `<A>/flyway/outbox/<recipient-segments>/<id>.yaml`.
8. Delivered the envelope via the local-fs transport into
   `<B>/flyway/inbox/<sender-segments>/<id>.yaml`.

### Step 6 — B checks its inbox

```
$ flyway check
Inbox: 1 signal (1 verified)
  - tension  1779742277466-156885dc  from did:web:github.com:xeeban:a  [sig valid]
```

`sig valid` here is independently produced by B from artifacts B
already holds: it reads the envelope from its own inbox, finds the
sender in its own `flyway/peers.yaml`, loads the peer DID document it
cached at recognition time, derives the expected domain from
`envelope.kind` (= `flyway-v1:tension`), and runs
`verifyInlineSignedArtifact`. No network calls; no re-fetch from A.

### Step 7 — B status

```
$ flyway status
Identity: did:web:github.com:emergent:praxis  (signature valid)
  Source:   Praxis
  Mode:     interactive

Peers:    1 recognized
  - Nori (did:web:github.com:xeeban:a) — sig valid
Agreements: 0 on file
```

Status is unchanged in shape — the inbox is not yet surfaced in status
output. That's a small gap worth noting (see below).

## On-disk evidence

### B's inbox file after Step 5

```yaml
# flyway inbox signal — delivered by a peer murmuration. Schema: flyway-signal-v0.
# Do not hand-edit; this file is a signed envelope.
schema: flyway-signal-v0
id: 1779742277466-156885dc
from: did:web:github.com:xeeban:a
to: did:web:github.com:emergent:praxis
sentAt: 2026-05-25T20:51:17.466Z
kind: tension
body:
  conditions: Andamio sprint reviews are running 90+ minutes over the planned slot.
  effect: The retrospective is being compressed or skipped entirely on those weeks.
  relevance: Both murmurations rely on retros to surface cross-circle tensions
    early; skipping them concentrates surprises into governance.
signature:
  verificationKeyId: did:web:github.com:xeeban:a#key-1
  algorithm: EdDSA
  canonicalization: flyway-jcs-v1
  domain: flyway-v1:tension
  signature: qXj3da6W4c1qImGUeF6pr5uHbiWTGNNHQw9WyO70iuLodWB-4HN4aQ0dJx5Wq_gr1B8RSpLmZ-zzy4i5OJc4Ag
```

### A's outbox file after Step 5

Identical envelope body and signature. The only difference is the
file header:

```yaml
# flyway outbox signal — sent to a peer. Schema: flyway-signal-v0.
# Do not hand-edit; this file is a signed envelope.
schema: flyway-signal-v0
id: 1779742277466-156885dc
…  (rest identical)
```

### File tree at B after the demo

```
<B>/.gitignore
<B>/.well-known/did.json
<B>/flyway/entity-statement.json
<B>/flyway/inbox/github.com/xeeban/a/1779742277466-156885dc.yaml
<B>/flyway/keys/source.key                          (private; gitignored)
<B>/flyway/peers.yaml
<B>/flyway/peers/github.com/xeeban/a/did.json
<B>/flyway/peers/github.com/xeeban/a/entity-statement.json
```

The pattern from ADR-0008 reads cleanly: peer cache from Tier 1
recognition lives at `flyway/peers/<host>/<owner>/<repo>/`; signals
from the same peer arrive at the structurally-parallel
`flyway/inbox/<host>/<owner>/<repo>/<id>.yaml`.

A's tree adds the symmetric `flyway/outbox/github.com/emergent/praxis/<id>.yaml`.

## Cryptographic properties exercised

| Property | How it shows up | Where verified |
| --- | --- | --- |
| Kind-specific domain | The signed envelope's `signature.domain` is `flyway-v1:tension`, not the generic `DOMAIN_SIGNAL` the alternative-considered section of ADR-0008 rejected. | `signal.ts` `domainForSignalKind`; `tension.test.ts` cross-kind replay rejection. |
| Cross-kind replay protection | Mutating `envelope.kind` after signing causes `verifySignedSignal` to fail (domain derived from `kind` no longer matches the signed domain). | `tension.test.ts` "rejects cross-domain replay" case. |
| Independent verifiability | B verifies A's signature using only the cached peer DID document — the same one B obtained at recognition time. | `check.ts` flow exercised end-to-end in Step 6. |
| Body validation at the sender | Empty `conditions` or `effect` is rejected before any signing happens — invalid tensions never become signed artifacts. | `tension.ts` `createTension`; `tension.test.ts` validation cases. |
| Trust gate at the sender | The sender refuses to deliver to an unrecognized peer. The signature would technically verify on the receiver side too, but flyway's stance is that signing is for relationships you've affirmatively committed to. | `tension.ts` CLI; `tension.test.ts` "refuses to send to an unrecognized peer". |

## Gaps surfaced

Some gaps are explicitly upcoming milestones rather than surprises:

- **No remote transport.** Only local-fs delivery is wired. GitHub-PR
  and URL-webhook are reserved in ADR-0008 and not in scope here.
  *(Not filing — known limitation, covered by future transport ADRs.)*
- **No response yet.** B can read the tension and verify the signature,
  but cannot acknowledge / dispute / dissolve / transfer it because
  `flyway_respond` is still stubbed. *(Not filing — next milestone.)*
- **No tension → proposal linkage exercised.** The envelope's `refs`
  field carries `tensionId` per ADR-0008, but no tool yet emits a
  proposal that links back. *(Not filing — belongs with `flyway_propose`.)*

Genuinely new gaps worth filing as issues:

- **G4 — `flyway_status` does not surface inbox state.** A Source
  running `flyway status` after receiving a tension sees no indication
  the inbox is non-empty. Status currently reports identity, peers,
  and agreements only. A line like `Inbox: 1 signal (1 verified)` (or
  `Inbox: 2 unread, 1 signature INVALID`) would let an operator notice
  unread or compromised signals without remembering to run `flyway
  check` separately. Low-risk, high-value addition; the data already
  exists in `flywayCheck`.

- **G5 — No idempotency receipt at the sender.** If `flyway tension`
  is invoked twice with the same body, two distinct envelopes are
  produced (different ids, different timestamps) and both are
  delivered. There is no way for the recipient to detect that A meant
  to send the same tension once. For tensions specifically this may
  be desirable (each invocation is its own act); for proposals and
  responses it likely is not. The right place to fix is probably at
  `flyway_propose` and `flyway_respond` boundaries, with explicit
  `--retry-of <id>` semantics rather than blanket dedup. Filing now
  so the question is settled before the next sender is built.

- **G6 — Tension body has no provenance for `proposedOwner`.** The
  field accepts any string, including DIDs the sender has not
  recognized. A peer could propose ownership transfer to a Source the
  recipient has never heard of. Today this is just data the recipient
  parses; once `flyway_respond` adds the `transfer` decision, the
  protocol should require the transfer target to be a recognized peer
  on at least one side (sender or recipient). File the constraint now
  so the response side is built with it in mind.

## Resolution of surfaced gaps

> *Will be filled in once issues are filed and resolved downstream,
> following the pattern established by the Tier 1 walkthrough's
> resolution section.*

## Links

- [`createTension` in flyway-core](../../packages/core/src/tension.ts)
- [`runTension` in flyway-cli](../../packages/cli/src/tension.ts)
- [`handleTension` in flyway-mcp](../../packages/mcp/src/handlers.ts)
- [ADR-0008 — signal transport convention](../adr/0008-signal-transport-convention.md)
- Previous walkthrough: [2026-05-21 — Tier 1 mutual recognition](./2026-05-21-tier1-mutual-recognition.md)

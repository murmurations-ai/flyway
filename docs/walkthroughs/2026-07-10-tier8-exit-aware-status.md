---
date: 2026-07-10
protocol-version: 0.2.0 (proposed)
kind: executable (test-backed)
tools-exercised: [flyway_exit, flyway_status]
outcome: an exited relationship and an agreement closed by exit read as closed from a single `flyway_status`, without ever rewriting the co-signed file
---

# Tier 8 — Exit-aware effective status

`flyway_exit` (S+6) proved a Source can always leave: a signed, unilateral
exit notice that no peer can prevent, written to the outbox (sender) and the
inbox (recipient) and — deliberately — **never mutating the co-signed
`flyway/agreements/<id>.yaml`**. The agreement's bytes are covered by both
signatures; exit is a *superseding record*, not an edit. The exit module said
so from the start: "the agreement's effective lifecycle state (closed) is read
from the presence of an exit that targets it, not by rewriting the signed
file."

But nothing *read* it. `flyway_status` reported peers and a bare count of
agreement files, so a relationship that had been exited still showed as an
ordinary peer and a closed agreement still showed as just another `*.yaml`.
This tier makes the exit lifecycle legible from a single read — the view
Tier 7 filed as **G-T7-2** and Issue #17 named. It exercises S+13
(ADR-0013): effective-state-as-read, plus the opaque `projectId` /
`syndicateId` membership labels that give `project` / `syndicate` exits
something to bind to.

## Why this is "test-backed" executable

Effective state is computed by reading real, signed exit envelopes and
verifying them the same way `flyway_check` does — so the executable evidence
is the **test suite**: it builds genuine `createExit` envelopes with real
Ed25519 signers, places them in the outbox / inbox exactly where the transport
would, seeds a real recognized-peer cache, and asserts what `flywayStatus`
derives. Signature verification, the recognized-peer gate, the `sentAt`
window, and the participant/membership matching are all real; nothing about
the closing logic is stubbed.

Reproduce:

```bash
pnpm -r build
pnpm --filter @murmurations-ai/flyway-core test status   # 31 tests, incl. the ADR-0013 suites
```

## The flow

```
Source A (did:web:github.com:xeeban:us)            what flyway_status reads back
──────────────────────────────────────            ──────────────────────────────────────────
state on disk before any exit:
  peers.yaml           → B recognized              Peers:    B — sig valid
  agreements/live.yaml → state: in-flight          Agreements: 1 on file, 0 closed
                          participants: [A, B]        - live [in-flight]
                          projectId: projX

A exits the project:
  flyway exit <B-repo-path> --target-type project --target projX
1. build + sign exit envelope (kind: exit)
2. writeSignalToOutbox(A)  ── flyway/outbox/<B>/<id>.yaml   (our own signed record)

  ── OR, symmetrically, B exits and A receives it:
     flyway/inbox/<B>/<id>.yaml   ── honored ONLY if it passes the flyway_check gate:
       recognized sender + signature verifies vs cached DID + sentAt >= recognizedAt

flyway_status now:
3. scan outbox + inbox for kind:'exit'
4. verify each inbox exit (a forged / unrecognized / retroactive file closes NOTHING)
5. map exits → effective state, the file untouched:
     peer exit      → the peer relationship + every agreement with that participant
     project exit   → agreements whose projectId   == target (other party a participant)
     syndicate exit → agreements whose syndicateId == target (other party a participant)
                                                   Peers:    B — sig valid   (recognition intact)
                                                   Agreements: 1 on file, 1 closed
                                                     - live [closed] (closed by project exit
                                                             — file still in-flight)
```

The file on disk still says `state: in-flight` and its two signatures still
verify — `effectiveState: closed` is a **view**, computed from records both
sides already hold (ADR-0008 immutability preserved). Recognition is likewise
untouched: an exited relationship with a still-valid recognition entry is
normal — exit ends joint commitments, it does not retract the identity
attestation (that is `flyway_unrecognize`).

## What the tests prove

| Property | Assertion |
| --- | --- |
| **Live relationship is clean** | no `closure`; `exits.count == 0` |
| **We-exited (outbox)** | a `peer` exit we sent ⇒ peer `closure.direction == 'we-exited'`, `via == 'peer'`, reason carried |
| **Peer-exited (inbox, verified)** | a signed inbox `peer` exit from the recognized peer ⇒ `closure.direction == 'peer-exited'` |
| **Recognition survives exit** | the exited peer's `recognitionValid` is still reported — exit ≠ unrecognize |
| **Forged inbox exit closes nothing** | unrecognized sender ⇒ not honored, surfaced in `exits.issues`, no closure |
| **Tampered inbox exit closes nothing** | mutated body ⇒ signature fails to verify ⇒ not honored |
| **File-closed vs exit-superseded** | `state: closed` on disk ⇒ `effectiveState: closed`, **no** `closure`; an exit ⇒ `effectiveState: closed` **with** `closure` and `fileState` preserved |
| **Peer exit closes the agreement** | `in-flight` + a `peer` exit for a participant ⇒ `effectiveState: closed`, `closedCount == 1` |
| **Project / syndicate exit is selective** | only the agreement whose `projectId` / `syndicateId` matches the exit `target` closes; a sibling stays `in-flight` |
| **Non-participant untouched** | a `peer` exit does not close an agreement the exiting peer is not party to |
| **Temporal guard** | an agreement whose `createdAt` post-dates the exit stays live — a stale exit never closes a *re-formed* collaboration |
| **Cross-peer replay refused** | a peer-signed exit dropped under the *wrong* inbox subtree is not honored (on-disk placement binding) |
| **Wrong-recipient replay refused** | a valid peer exit addressed to a *third party*, replayed into our inbox, is not honored |
| **Retroactive refused** | an inbox exit with `sentAt < recognizedAt` closes nothing |
| **Outbox authenticity** | an outbox file that doesn't verify against *our* DID document is not trusted as "we-exited" |
| **Typo advisory** | a `project`/`syndicate` exit matching zero agreements surfaces `… matched no agreement` |
| **Unknown state flagged** | a non-lifecycle `state:` string is reported as an issue, not echoed as a real state |

All hold at HEAD (31 tests); `flyway status` (human + `--json`) and the MCP
status tool carry the new fields end-to-end.

## Gaps surfaced

- **G-T8-1 — membership ids are opaque and unenforced.** flyway does not
  verify that a `projectId` names any proposed project. The exit `target` is
  unilateral free text, so a typo fails to match — now surfaced as an
  advisory (`… matched no agreement`) rather than a silent no-op, but still
  unenforced. A first-class, verifiable Project object, or binding an exit to
  a specific `agreementId` via the envelope `refs`, is a possible successor
  (ADR-0013, Consequences + Alternatives §2).
- **G-T8-2 — one exit notice per peer.** A project spanning three peers needs
  three notices to close on every side; status closes each agreement as the
  relevant notice is seen. This matches the per-peer signal model and is
  called out rather than hidden.
- **G-T8-3 — "offered vs accepted" delivery state is still not surfaced.**
  Tier 7's G-T7-2 asked `flyway_status` to distinguish a PR *offered* from
  one *merged*. This tier closes the *exit* half of Issue #17 (closed
  relationships/agreements); the inbox/outbox delivery-state half remains
  open on #17.

## Relationship to the protocol

Exit was already unstoppable (S+6); this tier makes its *consequences*
legible. Effective state is the first place flyway reconciles an immutable,
co-signed artifact with a superseding signal — a pattern that generalizes:
any future lifecycle transition that must not rewrite a signed file (renewal,
suspension, transfer) can be read the same way, from verified records, with
the artifact left untouched. Combined with Tiers 6–7 (the discover → recognize
→ deliver loop at a distance), a Source can now stand up a collaboration
across an org boundary, run it, and — from a single `flyway_status` — see
exactly which relationships and agreements are still live.

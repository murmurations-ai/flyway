# ADR-0013 — exit-aware effective status & agreement membership

- **Status:** Accepted
- **Date:** 2026-07-10
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** [ADR-0008](./0008-signal-transport-convention.md) (signal envelope),
  [ADR-0009](./0009-antecedent-verification-before-signing.md) (verify before trust),
  `flyway_exit` module doc (S+6)

## Context

`flyway_exit` (S+6) produces a signed, unilateral exit notice — for a
`peer`, a `project`, or a `syndicate` — that lands in the sender's outbox
and the recipient's inbox and **never mutates the co-signed
`flyway/agreements/<id>.yaml`**. That immutability is deliberate: the
agreement file's bytes are covered by both signatures, so exit is a
*superseding record*, not an edit. The exit module's own doc comment says
it plainly: "the agreement's effective lifecycle state (closed) is read
from the presence of an exit that targets it, not by rewriting the signed
file."

But nothing *reads* it. `flyway_status` today reports identity, peers, and
a bare count of agreement files. A relationship that has been exited still
shows as an ordinary peer; an agreement that has been closed by exit still
shows as just another `*.yaml`. The exit lifecycle is on disk but
illegible — an operator (or agent) has to hand-read raw inbox/outbox
signals to learn a collaboration is over. This is the gap Issue #17
(surface inbox state) and the v0.2 roadmap's "exit-aware status" item name.

Two things block a clean read:

1. **No effective-state computation.** Status never looks at exit signals,
   so there is nowhere the "file says in-flight, but an exit superseded it
   to closed" reconciliation happens.
2. **`project` / `syndicate` exits have nothing to bind to.** A `peer` exit
   names a DID that already appears in `agreement.participants`, so it can
   be mapped. But a `project` or `syndicate` exit names an *id* that no
   agreement carries — a "project" in flyway is only a proposal *type*
   (markdown body, no standing object) and a "syndicate" is not a
   first-class object at all. There is no field an agreement could be
   matched on.

## Decision

**Teach `flyway_status` to compute an *effective* lifecycle state for each
peer relationship and each agreement by reading verified exit signals, and
give agreements an optional membership label so `project` / `syndicate`
exits have something to bind to. The co-signed file is never written.**

The load-bearing decisions:

1. **Agreement membership is an opaque, optional label — not a new signed
   object.** `FlywayAgreement` gains two optional flat fields,
   `projectId?: string` and `syndicateId?: string`, mirroring the existing
   flat optional `originTensionId`. They are ids the participants agree on
   inside the agreement; flyway does not invent a standing Project or
   Syndicate entity in this ADR. Because the fields live *inside* the
   agreement object, they are covered by the co-signature automatically and
   travel through `materialize` with no new plumbing (they join
   `AGREEMENT_FIELD_ORDER` for deterministic emission). A `project` exit
   `target` matches `agreement.projectId`; a `syndicate` exit `target`
   matches `agreement.syndicateId`.

2. **Effective state is read, never written.** `flyway_status` derives an
   `effectiveState` per agreement:
   - if the file's own `state` is `closed`, effective is `closed`;
   - else if a **verified** exit supersedes it (below), effective is
     `closed` and the status entry names the superseding exit;
   - else effective equals the file `state`.
   The file on disk is untouched — immutability (ADR-0008) is preserved.
   Peer entries gain a symmetric `closure?` record when a peer relationship
   has been exited.

3. **An inbox exit is honored only if it passes the full `flyway_check`
   trust gate.** A signal sitting in the inbox is a *claim*. Before an inbox
   exit is allowed to close anything it must: sit under the sender's inbox
   subtree (`flyway/inbox/<segments-of-from>/…` — the on-disk placement
   binding, so a peer can't replay another peer's genuinely-signed exit from
   their own delivery path); be **addressed to us** (`to == our DID`, so a
   peer's exit to a third party can't be replayed to close *our*
   relationship); come from a recognized peer (present in
   `flyway/peers.yaml`); verify against that peer's recognition-time cached
   DID document; and have `sentAt >= recognizedAt` (no retroactive exits —
   same rule ADR-0009 / Issue #16 apply at check). An unsigned, forged,
   misplaced, mis-addressed, or unrecognized-sender inbox file **cannot**
   close anything; it surfaces as an issue. Outbox exits are honored only if
   they are actually from us and verify against our own DID document —
   trusting outbox write-isolation implicitly would be a hole a future
   PR-merge transport could open. *(The gate is a faithful superset of
   `flyway_check`'s `inspectSignalFile`; extracting one shared
   `verifyInboxSignal` predicate so the two provably can't drift is a
   tracked follow-up.)*

4. **Exit → closed mapping (both directions), scoped in time.** An exit has
   a *direction* from the reading Source's vantage: `we-exited` (found in
   our outbox) or `peer-exited` (found, verified, in our inbox). An exit
   **cannot close an agreement created after it** (`agreement.createdAt >
   exit.sentAt` ⇒ no match): exit does not retract recognition, so
   re-collaborating with a previously-exited peer is a first-class flow and
   a stale exit must not close the *new* agreement.
   - **peer** exit → closes the peer relationship *and* every prior agreement
     in which the exited/​exiting peer is a `participant`. (Exit ends joint
     commitments; it does **not** retract recognition — that is
     `flyway_unrecognize`.)
   - **project** exit → closes every prior agreement whose `projectId` equals
     the exit `target` and in which the other party is a participant.
   - **syndicate** exit → same, keyed on `syndicateId`.
   Effective `closed` is a **monotone latch** — any non-closed file state
   (including `suspended`) goes effective-`closed` under a matching exit, and
   re-entry after exit is out of scope for v1 (the temporal guard is what
   keeps a *new* post-exit agreement live).

5. **Surface it end-to-end.** The new fields flow through core
   `flywayStatus`, the CLI `flyway status` renderer, and the MCP status
   tool result, so an agent on any adapter sees closed relationships and
   agreements without re-reading raw signals.

## Consequences

**Positive:**

- The exit lifecycle becomes legible from a single read. `flyway status`
  answers "is this collaboration still live?" directly, on every adapter.
- Immutability of co-signed agreements is preserved — effective state is a
  *view*, computed from records both sides already hold, never a mutation.
- `project` / `syndicate` exits finally have a binding target, closing the
  loop the exit tool opened at S+6 without inventing a heavyweight
  standing-entity model.
- Verification is not weakened: honoring an inbox exit reuses the exact
  `flyway_check` gate, so status cannot be tricked into closing a live
  relationship by a dropped-in file.

**Negative / residual risk:**

- **Status now parses agreement files and verifies exit signatures**, where
  before it only counted filenames. More I/O and crypto per call; mitigated
  because status is already async and the counts are small. Failures are
  reported as per-entry issues, never thrown.
- **Membership ids are opaque and unenforced.** flyway does not (yet)
  verify that a `projectId` corresponds to any proposed project. The
  agreement's `projectId` is co-signed, but the **exit's `target` is
  unilateral free text** typed at exit time and validated against nothing —
  so the real foot-gun is a typo in the *exit target*, which the
  co-signature does not defend against. Mitigation: a honored
  `project`/`syndicate` exit that matches **zero** agreements is surfaced as
  an advisory issue (`… matched no agreement — check the target label`), so
  a mistyped exit reads as a visible no-op rather than a silent one. A
  standing, verifiable Project object (or binding an exit to a specific
  `agreementId` via the envelope `refs`, which the plumbing already allows)
  is a possible successor if stronger guarantees are wanted.
- **One exit notice per peer.** A project spanning three peers needs three
  exit notices to fully close on every side; status closes each agreement
  as the relevant notice is seen. This matches the per-peer signal model
  and is called out rather than hidden.

**Reversibility:** high. The agreement fields are additive and optional
(older agreements simply have no membership and are unaffected). The status
computation is read-only and derives a view; removing it reverts status to
the count-only report with no on-disk change. No envelope, agreement-file,
or trust-model change is required to undo it.

## Alternatives considered

1. **Rewrite the agreement file's `state` to `closed` on exit.** Rejected:
   the co-signature covers the file's bytes; rewriting `state` invalidates
   it (or forces a re-sign neither party consented to). Effective state as
   a computed view is the only option that keeps the artifact immutable.
2. **A first-class, signed Project/Syndicate object that agreements
   reference by verified id.** Rejected *for now*: heavier than the problem
   demands. No standing project object exists today, and the opaque co-signed
   label closes the exit loop at a fraction of the cost. Left as a possible
   successor if verifiable grouping is needed.
3. **Honor any inbox exit without verification (trust the filesystem).**
   Rejected outright: it would let anyone close a live collaboration by
   dropping a file into the inbox. Status must reuse the `flyway_check`
   trust gate; an exit is a signed claim, not an ambient fact.
4. **Nested `membership: { project, syndicate }` object instead of flat
   fields.** Rejected for consistency: the schema's other optional scalars
   (`originTensionId`, `trigger`) are flat; two flat ids read the same and
   need no nested-object handling in `AGREEMENT_FIELD_ORDER`.

## Links

- [ADR-0008](./0008-signal-transport-convention.md) — signal envelope +
  inbox/outbox layout the exit records live in; immutability of co-signed files
- [ADR-0009](./0009-antecedent-verification-before-signing.md) — verify
  before trust; reused as the gate for honoring an inbox exit
- [`exit.ts`](../../packages/core/src/exit.ts) — the S+6 exit module whose
  "effective state is read, not written" contract this ADR realizes
- [`status.ts`](../../packages/core/src/status.ts) — where the effective-state
  computation lands
- [`agreements.ts`](../../packages/core/src/agreements.ts) — `projectId` /
  `syndicateId` membership fields
- [Issue #17](https://github.com/murmurations-ai/flyway/issues/17) —
  `flyway_status` should surface inbox state

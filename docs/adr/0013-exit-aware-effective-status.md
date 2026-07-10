# ADR-0013 — exit-aware effective status & agreement membership

- **Status:** Proposed
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

3. **An inbox exit is honored only if it passes the `flyway_check` trust
   gate.** A signal sitting in the inbox is a *claim*. Before an inbox exit
   is allowed to close anything it must: come from a recognized peer
   (present in `flyway/peers.yaml`); verify against that peer's
   recognition-time cached DID document; and have `sentAt >= recognizedAt`
   (no retroactive exits — same rule ADR-0009 / Issue #16 apply at check).
   An unsigned, forged, or unrecognized-sender inbox file **cannot** close a
   relationship or an agreement; it surfaces as an issue instead. Outbox
   exits are our own signed records and are trusted as authored.

4. **Exit → closed mapping (both directions).** An exit has a *direction*
   from the reading Source's vantage: `we-exited` (found in our outbox) or
   `peer-exited` (found, verified, in our inbox).
   - **peer** exit → closes the peer relationship *and* every agreement in
     which the exited/​exiting peer is a `participant`. (Exit ends joint
     commitments; it does **not** retract recognition — that is
     `flyway_unrecognize`.)
   - **project** exit → closes every agreement whose `projectId` equals the
     exit `target` and in which the other party is a participant.
   - **syndicate** exit → same, keyed on `syndicateId`.

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
  verify that a `projectId` corresponds to any proposed project; a typo in
  the label silently fails to match an exit. Acceptable for v1 — the ids
  are co-signed, so both parties agreed to the exact string; a standing,
  verifiable Project object is a possible successor ADR if demand appears.
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

# ADR-0009 — Antecedent verification before signing

- **Status:** Accepted
- **Date:** 2026-05-25
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** internal architecture review of S+3 / S+4

## Context

flyway is a graph of signed attestations: identity statements,
recognitions, tensions, responses, and (soon) proposals and exits.
Every link in that graph is one Source vouching for an artifact in
their possession — sometimes for an artifact they produced, sometimes
for an artifact they received from a peer.

When a Source signs over an artifact they received (a recognition over
a peer's entity statement, a response over a peer's tension), they
are doing something delicate: their *own* signature is now load-bearing
for the antecedent's authenticity in the eyes of downstream observers.
If the antecedent was tampered with — wrong key, wrong content, wrong
sender — the new signature laundrers the breakage into a chain that
*does* verify.

We have implemented this verification inconsistently:

- `recognizePeer` (S+1) verified the peer entity statement before
  signing the recognition entry. The rule lived in core.
- `runRespond` (S+4 initial) verified the subject tension before
  signing the response, but the rule lived in the CLI adapter.
  `handleRespond` (MCP) duplicated the verification — defense in
  depth, but with no shared enforcement point.
- `runTension`, `createTension` had no antecedent and so needed no
  rule.

External architecture review pointed at the asymmetry: the same
load-bearing rule had three implementations, one per adapter, and
no single source of truth. A future `flyway_propose` (which signs
over a tension being promoted) and a future `flyway_respond` for
proposals (which signs over a proposal) will replicate the rule a
fourth and fifth time. Each replication is a chance to forget the
check, or to use the *wrong* verifying key — e.g., reading the peer's
DID document fresh from an attacker-controlled path instead of from
the recognition-time cached copy.

A separate security finding from the same review made the bug
concrete: `runRespond` was reading `peerDidDocument` fresh from
`<peerRepoPath>/.well-known/did.json` and verifying the subject
signature against it. An attacker who controls that file can supply
a matching public key for a tension they fabricated — recognition
binds the *string* DID, not the document. The fix is twofold:
(1) verify against the cached, recognition-bound key; (2) make sure
this verification cannot be skipped by *any* adapter.

## Decision

**A signer never signs an attestation over an unverified antecedent
artifact. Verification (of the antecedent's signature and of the
binding between antecedent and verifier) is performed in core, at the
signing primitive itself, using the recognition-time cached
verification key.**

Concretely:

1. **The rule lives in core.** Every signing primitive that has an
   antecedent (`recognizePeer`, `createTensionResponse`, future
   `createProposal` when promoting a tension, future
   `createProposalResponse`, future `exit`) takes the antecedent
   artifact and the antecedent-sender's DID document as required
   inputs, and verifies internally. Adapters cannot construct the
   signed artifact without supplying both.

2. **The verifying key is the recognition-time cached copy.** Adapters
   load the peer DID document from `flyway/peers/<peer-segments>/did.json`
   (written at recognition time) and pass it in. They MUST NOT use a
   freshly-read `.well-known/did.json` from a peer-controlled path
   for verification; if that path is used at all, it is only as a
   discovery hint for *which* peer corresponds to a path, and the
   discovered DID is then looked up in the cache.

3. **Adapters validate location, not authenticity.** The CLI's
   peer-path-vs-subject.from cross-check stays in the CLI (it's a UX
   affordance — "you typed the wrong peer for this subject"). But the
   cryptographic check that the subject *is* what it claims to be
   moves to core.

4. **MCP handlers become thin.** The MCP handler for any tool that
   signs over an antecedent takes the antecedent envelope and the
   peer DID document as arguments, then delegates to the core
   primitive. The handler does not run verification itself — that
   would be a duplicate enforcement point that could drift from
   core's.

### Required checks at the signing primitive

For each kind of antecedent verification, the core primitive performs
these checks before signing, in order:

1. **Kind match.** The antecedent's `kind` matches what the signing
   primitive expects (e.g. `subjectEnvelope.kind === 'tension'` when
   producing a tension response).
2. **Id match.** Any reference field (`refs.tensionId`,
   `refs.proposalId`) points at the antecedent's `id`.
3. **Sender match.** The antecedent's `from` equals the new
   artifact's `to`. (You respond to a peer; the response must go
   back to the antecedent's sender.)
4. **DID-document binding.** The supplied `subjectSenderDidDocument`'s
   `id` matches the antecedent's `from`. Catches a confused-deputy
   where the adapter supplied the wrong cached document.
5. **Signature verification.** The antecedent verifies under the
   supplied DID document and the antecedent's kind-specific domain.

Any failure aborts the operation. No signed artifact is produced.

## Consequences

**Positive:**

- The rule is enforced in exactly one place. Future tools that sign
  over antecedents inherit the check by construction.
- The verifying key is bound to the recognition act, not to whatever
  path the user supplied at sign time. The class of "wrong peer
  document" attacks is structurally blocked at the core boundary.
- Architectural review is simpler: a new signing function with an
  antecedent must take the antecedent and the sender DID document; if
  it doesn't, the omission is visible from the function signature.
- The CLI and MCP layers lose an entire class of bug — they no
  longer carry a security-critical check that could drift from core.

**Negative:**

- The signing-primitive signature widens for any tool with an
  antecedent (one extra DID-document parameter and one extra envelope
  parameter). Acceptable: the alternative is silent drift.
- Migration cost is paid once per existing tool. We pay it now for
  `createTensionResponse`; future tools are clean from the start.

**Reversibility:** medium. The rule is documented and enforced in
core. If we ever find we need to *defer* verification (batched
re-verification at audit time?), we can re-introduce adapter-side
verification with an opt-in flag, but the default should remain
"verify at sign time."

## Alternatives considered

1. **Adapter-side verification only (current S+4 state pre-fix).**
   Rejected: three adapters means three copies of a load-bearing
   rule, and the review surfaced an actual security bug (wrong
   key source) hidden by exactly this duplication.

2. **Verification at receive time instead of sign time.**
   Rejected: by the time a third party reads our signed response,
   the antecedent's authenticity is part of *our* attestation. We
   either vouch for it (and verified) or we don't sign. "Verify on
   read" pushes the burden to every future consumer of the chain.

3. **A single helper function that adapters call before invoking the
   signing primitive.**
   Rejected: the helper-vs-call-site split is exactly what we just
   had. The point is that the verification cannot be skipped, even
   by mistake. Putting the check inside the signing primitive
   enforces this at the type system.

4. **Trust the peer-path-supplied DID document because the peer is
   recognized.**
   Rejected: recognition binds the *DID string*, not the document
   layout at that DID's web location. A recognized peer (or an
   attacker who can write to that peer's `.well-known/`) can supply
   any document. The recognition-time cached copy is the only
   document we have actually attested to.

## Links

- [ADR-0007 — pluggable signers and on-chain anchoring](./0007-pluggable-signers-and-anchors.md)
- [ADR-0008 — signal transport convention](./0008-signal-transport-convention.md)
- [`createTensionResponse`](../../packages/core/src/respond.ts) — first primitive built under this rule
- [`recognizePeer`](../../packages/core/src/recognize.ts) — pre-dates this ADR; conforms by accident
- Architecture review (2026-05-25) — surfaced the asymmetry as ARCH-7
- Security review (2026-05-25) — surfaced the wrong-document attack as SEC-2

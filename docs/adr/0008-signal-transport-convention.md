# ADR-0008 — Signal transport convention

- **Status:** Proposed
- **Date:** 2026-05-21
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

After SHA `f9911fd` (Milestone S+1), three flyway tools actually run:
`flyway_init`, `flyway_status`, `flyway_recognize`. The remaining
protocol surface — `flyway_tension`, `flyway_propose`, `flyway_respond`,
`flyway_check`, `flyway_exit` — all share a missing piece: **how does a
signal from murmuration A reach murmuration B?**

Recognition was an exception: it is *unilateral*. A reads B's published
artifacts, signs an attestation, writes it to A's own repo. Nothing moves
to B. But every other tool in the protocol involves one Source delivering
a message to another. We need a convention before we build the senders,
because the on-disk shape of received signals constrains the shape of
`flyway_check`, which has to verify them, and constrains every tool that
emits them.

There are three coupled but separable concerns. Conflating them produces
the wrong design (a transport baked into the protocol, or a protocol
that only works for one transport):

- **Envelope** — the signed artifact that *is* a signal.
- **Location** — where on disk a delivered signal lives.
- **Transport** — how bytes actually move from one Source's machine to
  another's repo.

We must commit to envelope shape and location now; transport is
pluggable.

## Decision

**A flyway signal is a signed envelope, delivered into a recipient
repo's `flyway/inbox/` and mirrored from the sender's `flyway/outbox/`.
Transport is pluggable; v0.1 ships a local-filesystem default and
reserves PR-based and URL-based transports for later ADRs.**

### Envelope

A signal is a signed JSON/YAML artifact with this shape:

```ts
type SignalKind = 'tension' | 'proposal' | 'respond' | 'exit'

interface SignalEnvelope {
  schema: 'flyway-signal-v0'
  id: string            // unique within sender; sortable by time
  from: string          // sender DID
  to: string            // recipient DID
  sentAt: string        // RFC 3339
  kind: SignalKind
  body: unknown         // kind-specific payload; the envelope is type-agnostic
  refs?: {              // optional links to prior signals
    inReplyTo?: string
    tensionId?: string
    proposalId?: string
  }
}

type SignedSignalEnvelope = SignalEnvelope &
  { signature: SignatureEnvelope }
```

**Signing.** The envelope is signed inline under a *kind-specific* domain
tag chosen from the signed `kind` field: `DOMAIN_TENSION`,
`DOMAIN_PROPOSAL`, `DOMAIN_RESPOND`, `DOMAIN_EXIT`. The verifier reads
`kind` from the (signed) envelope, derives the domain, and verifies. The
signed payload always includes `kind`, so kind-spoofing is impossible
without invalidating the signature.

**Why kind-specific domains.** Domain separation prevents cross-kind
replay: a `respond` signature cannot be presented as a `proposal`. The
alternative — a single `DOMAIN_SIGNAL` — would let an attacker who
captures a signed signal reuse it as a different kind by mutating only
unsigned context. This costs nothing to enforce now and is hard to
retrofit later.

**IDs.** Signal ids are sender-generated, unique per sender, and
sortable by time. The default scheme is `<unix-ms-zero-padded-13>-<8-hex>`
(e.g. `0001747929612345-3a7f9d21`). Other schemes are permitted as long
as they fit `^[A-Za-z0-9_-]{1,128}$` and are unique per sender. Receivers
treat ids opaquely and rely on `(from, id)` for uniqueness.

### Location

Two parallel hierarchies, both mirroring the GitHub-URL layout already
used by `flyway/peers/`:

```
recipient repo:
  flyway/inbox/<host>/<owner>/<repo>/<id>.yaml      # received from this DID

sender repo:
  flyway/outbox/<host>/<owner>/<repo>/<id>.yaml     # sent to this DID
```

- The `<host>/<owner>/<repo>` segments come from `did:web:host:owner:repo`
  (the existing `peerCachePathSegments` helper).
- One file per signal. Idempotent: re-delivering the same `(from, id)`
  is a no-op; the file's signature must match.
- Both directories are gitignored only at the Source's discretion —
  the default for v0.1 is to commit them, since they are part of the
  Source's auditable governance history.

The sender always writes to their own outbox **first** (so the act of
sending is recorded even if delivery fails), then attempts delivery to
the recipient inbox via the chosen transport.

### Transport

A transport is a function `(envelope, recipientLocation) → Promise<DeliveryReceipt>`.
v0.1 ships exactly one:

- **local-fs** — directly writes the envelope into the recipient repo's
  `flyway/inbox/<...>/<id>.yaml`. Caller supplies the local path to the
  recipient's repo. This is the only transport that exists at SHA-of-this-ADR
  and is intended for two-murmurations-on-one-machine demos and tests.

Reserved for future ADRs (not in scope for this one):

- **github-pr** — production transport. Sender opens a PR against the
  recipient's repo adding a file to `flyway/inbox/<...>/<id>.yaml`. The
  recipient merges or rejects per their own governance. Real, durable,
  auth-heavy.
- **url-webhook** — recipient publishes an HTTP endpoint that accepts
  signed envelopes. Lower-latency but introduces an online dependency
  the rest of flyway deliberately avoids.

`flyway_check` is **transport-agnostic.** It reads whatever is in
`flyway/inbox/<...>/` and verifies each envelope. It does not know how
the bytes got there.

### flyway_check scope (this milestone)

`flyway_check` is implemented in this milestone and reports:

| Field | Meaning |
| --- | --- |
| `signals[]` | One entry per file under `flyway/inbox/<...>/*.yaml` |
| `signals[].envelope` | The parsed envelope |
| `signals[].path` | The on-disk path |
| `signals[].fromRecognized` | True iff the sender DID is in our `flyway/peers.yaml` |
| `signals[].signatureValid` | True iff the envelope signature verifies against the cached peer DID document (under the kind-specific domain). Undefined when sender is unrecognized (we have no key). |
| `signals[].issues[]` | Human-readable problems: malformed envelope, unrecognized sender, signature mismatch, kind/domain mismatch |
| `totalCount` / `validCount` | Counts |

Verification flow per signal:

1. Parse the YAML, narrow to `SignedSignalEnvelope`. If malformed → issue.
2. Look up sender in `flyway/peers.yaml`. If absent → flag as unrecognized
   and skip signature check (we cannot verify what we have no key for).
3. Load cached peer DID document from
   `flyway/peers/<peer-segments>/did.json`. If missing → issue.
4. Derive the expected domain from `envelope.kind`.
5. Run `verifyInlineSignedArtifact(domain, envelope, peerDidDoc)`.

`flyway_check` does **not** delete or move signals from the inbox.
Lifecycle management (mark-as-read, archive) is a separate concern that
later tools (`flyway_respond`) will handle as part of their semantics.

## Consequences

**Positive:**

- Unblocks `flyway_check` today and every later sending tool tomorrow.
- Envelope shape is settled before any sender exists, so the senders
  drop in without changing what receivers expect.
- Same on-disk shape works for local-fs, GitHub-PR, and URL transports;
  swapping transports is invisible to receivers.
- Audit trail is per-side and complete: every signal sent is in the
  sender's outbox; every signal received is in the recipient's inbox.
- Kind-specific domain tags prevent cross-kind replay without any extra
  protocol machinery.

**Negative:**

- Local-fs transport is "spooky action at a distance" — the sender's
  process must have write access to the recipient's repo directory.
  Acceptable for v0.1 demos; not production.
- Inbox/outbox files committed to git inflate repo history. Mitigation:
  Sources may gitignore these paths if they accept the loss of audit
  trail. v0.1 default is to commit.
- Idempotency depends on `(from, id)` uniqueness; misbehaving senders
  that reuse ids could overwrite history. Mitigation: receivers refuse
  to overwrite an existing file with a *different* signature; identical
  re-delivery is a no-op.

**Reversibility:** medium-high. The envelope shape is what's hardest to
change; we have settled it explicitly so future-us doesn't have to.
Location is a string convention; renaming `inbox/` → `signals-in/` is
mechanical. Transports are independent additions.

## Alternatives considered

1. **Single combined envelope domain (`DOMAIN_SIGNAL`).** Rejected: loses
   cross-kind replay protection for no real gain. Domain separation is
   cheap to enforce now and noisy to retrofit.

2. **Flat inbox (`flyway/inbox/<safe-did>__<id>.yaml`).** Rejected:
   harder to browse, breaks the mirror with `flyway/peers/`. The
   hierarchical layout costs nothing and reads better.

3. **No outbox.** Rejected: the sender needs a record of what they sent,
   independent of whether the recipient's inbox is reachable later. The
   asymmetry would also bias the audit trail.

4. **Sign the envelope with `DOMAIN_SIGNAL`, then re-sign each kind
   separately under its own domain.** Rejected as gratuitous double
   signing. The kind is in the envelope; the domain is derived from the
   kind; one signature suffices.

5. **Defer envelope shape until the first sender is built.** Rejected
   because every sender depends on this. Building one and then changing
   the shape would cascade through the rest. We pay the design cost once.

6. **First-class delivery receipts (recipient signs "received").**
   Considered, deferred. Useful for non-repudiation but adds a synchronous
   round-trip that the protocol's "eventually-consistent via git" stance
   does not require. Revisit when there is a real consumer.

## Links

- [ADR-0007](./0007-pluggable-signers-and-anchors.md) — pluggable signers; signal envelopes use the same Signer interface
- [`signing.ts`](../../packages/core/src/signing.ts) — domain separation
- [Issue #5](https://github.com/murmurations-ai/flyway/issues/5) — multi-party consent flow; signal transport is a precondition
- [Issue #2](https://github.com/murmurations-ai/flyway/issues/2) — tension→proposal linkage; uses signal `refs` field

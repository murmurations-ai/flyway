# ADR-0007 — Pluggable signers and on-chain anchoring (optional)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

flyway artifacts (entity statements, recognition envelopes, agreements,
respond payloads) need to be cryptographically signed so a third party
can verify that a Source actually said what their repo claims they
said. The README has called this out as the next milestone since
SHA `eec423c`:

> The first tool — `flyway_init` — actually runs, generating a real
> did:web identity (DID document, entity statement, ed25519 keypair)
> and writing it to the canonical paths. **Signing of artifacts and
> the rest of the tool surface are next.**

Today `flyway_init` produces an Ed25519 keypair and a W3C-compliant DID
document, but no artifact is yet signed by that key. We are about to
implement signing — and before we hard-wire `crypto.sign('ed25519', …)`
into `flyway-core`, we have a forcing function:

Several Sources in our orbit operate on or alongside the **Cardano**
blockchain — Andamio (on-chain trust and credentials), Cardano-native
DAOs, SAMON and other stake pools. There is an obvious desire to:

1. **Sign** flyway artifacts using a Cardano hot key (so the signing
   identity is the same key already used for on-chain activity),
2. **Anchor** the hash of an agreement on-chain (so the existence and
   timing of the agreement is provable without trusting GitHub or the
   `did:web` resolution chain),
3. **Carry credentials** from Andamio (or any on-chain credentialing
   system) on the entity statement, so a peer can verify reputation /
   role / membership without out-of-band trust.

The lucky alignment: **Cardano uses Ed25519**, which is exactly the
curve flyway's DIDs already use. A Cardano spending key and a flyway
DID verification key are the same cryptographic primitive; only the
encoding and the verification surface differ. So this is not "add a
second signature scheme" — it is "give the existing scheme more places
to live."

We need to decide the architectural shape *now*, before signing lands,
so the seam is intentional and the Cardano path stays clean and
optional. Failure mode if we don't: signing ships as a hard-coded
local primitive, and Cardano support later requires a refactor of every
artifact-producing function.

This ADR is also the place where we commit to **what flyway is not** in
the chain dimension: not a Cardano product, not a Cardano dependency,
not a tool that requires any blockchain to function.

## Decision

**flyway-core defines pluggable `Signer` and `Anchor` interfaces. The
default `Signer` is local Ed25519. The default `Anchor` is none.
Chain-specific implementations ship as separate, optional packages.**

### Three separable concerns

We deliberately distinguish three things that often get conflated under
"blockchain integration":

| Concern | Definition | Default | Required? |
| --- | --- | --- | --- |
| **Signing** | Produce a signature over a canonical artifact (entity statement, recognition, agreement, response). | Local Ed25519 (Node `crypto`). | **Yes** — every Source signs. |
| **Anchoring** | Write a hash of an artifact (or a pointer to one) to an external ledger so a third party can prove it existed at time T. | None. | **No** — optional per Source, per artifact. |
| **Credentialing** | Carry verifiable claims (role, membership, reputation) issued by an external system, attached to the entity statement. | None. | **No** — optional, declarative. |

Each is its own interface. They are composable but independent: a
Source can use a Cardano hot key as their signer without anchoring
anything on-chain, can use the local default signer while still
anchoring agreement hashes to Cardano, and can carry Andamio
credentials regardless of which signer they use.

### Interfaces (shapes, not final code)

In `flyway-core`:

```ts
// One signing operation. Synchronous for the local default; async for
// remote signers (HSM, wallet, KMS).
export interface Signer {
  readonly id: string                       // e.g. "local-ed25519", "cardano-hot"
  readonly publicKey: PublicKeyJwk          // for embedding in DID doc / verification
  sign(canonicalBytes: Uint8Array): Promise<SignatureEnvelope>
}

export interface SignatureEnvelope {
  signer: string                             // matches Signer.id
  algorithm: 'EdDSA'                         // Ed25519 today; widened only if needed
  signature: string                          // base64url
  signedAt: string                           // RFC 3339
  // Optional, signer-specific metadata (e.g. cardano-address, wallet-derivation-path)
  meta?: Record<string, string>
}

// Optional. Writes a hash of canonical bytes to an external system and
// returns a proof a verifier can later check.
export interface Anchor {
  readonly id: string                        // e.g. "cardano-mainnet", "ipfs"
  anchor(hash: Uint8Array, refId: string): Promise<AnchorReceipt>
  verify(receipt: AnchorReceipt, hash: Uint8Array): Promise<boolean>
}

export interface AnchorReceipt {
  anchor: string                             // matches Anchor.id
  network: string                            // 'mainnet' | 'preprod' | etc.
  ref: string                                // chain-specific (tx hash, CID, …)
  anchoredAt: string                         // RFC 3339
  blockHeight?: number
  meta?: Record<string, string>
}
```

Credentials are a declarative field on the entity statement, not an
interface — resolution is the verifier's job:

```ts
// Added to entity-statement.json
credentials?: Array<{
  type: string                               // e.g. "andamio-trust", "did-vc"
  issuer?: string                            // DID or chain ref of the issuer
  ref: string                                // resolvable pointer (tx, CID, URL)
  issuedAt?: string
}>
```

### Default and optional implementations

**In `flyway-core` (shipped, required):**

- `localEd25519Signer(privateKeyPem: string): Signer` — wraps Node
  `crypto.sign('ed25519', …)`. This is what `flyway-init` already
  produces a key for. Becomes the default signer everywhere.

**Future optional packages (separate, not blocking):**

- `@murmurations-ai/flyway-cardano`
  - `cardanoSigner(opts): Signer` — backed by a Cardano hot key or
    CIP-30 wallet bridge. Signs flyway artifacts using the same Ed25519
    primitive as the local default; the difference is the key
    custody/derivation path and the embedded `meta` (e.g. stake
    address).
  - `cardanoAnchor(network, provider): Anchor` — writes an artifact
    hash as transaction metadata (CIP-25 / CIP-68 style) and returns
    `{ tx, block, slot }` as the receipt. Verifies by re-reading the
    transaction.

- `@murmurations-ai/flyway-andamio`
  - Builds on `flyway-cardano`. Provides credential resolution for the
    `andamio-*` credential types — given an entity statement's
    `credentials[]`, returns issuer / status / scope.

Neither of these is on the v0.1 milestone. They are listed here so the
interface shape is sized to absorb them without rework.

### Verification method extension in the DID document

The DID document already lists `verificationMethod[]`. A Source using a
Cardano-resident key publishes the **same Ed25519 public key** under an
additional verification method id (e.g. `#cardano-stake-key`), with the
Cardano-specific encoding (bech32 stake address) in a meta field. The
DID document remains W3C-conformant; the extra method is metadata for
verifiers who care, ignorable for those who don't.

### Key reuse guidance

Ed25519 keys for flyway DIDs and Cardano spending keys are
cryptographically interchangeable, but **reusing one key for both is a
documented hazard** (cross-protocol signature confusion, accidental
on-chain spends from a flyway key, etc.). flyway will:

- Recommend separate keys by default (signing key ≠ wallet key).
- When a Source explicitly opts into reuse, the flyway CLI surfaces a
  one-time confirmation prompt and a docs link.
- Domain separation tags are baked into the canonicalization of
  flyway-signed payloads so a flyway signature cannot be replayed as a
  Cardano transaction signature or vice versa.

### Scope for the next milestone (signing)

The signing milestone implements only:

1. `Signer` interface in `flyway-core`.
2. `localEd25519Signer` as the default implementation.
3. Wiring `flyway_init`'s output to be signed (the entity statement
   gains a `signature` field that round-trips through verify).
4. A `verifySignedArtifact(artifact, didDoc)` helper.

The signing milestone does **not** implement:

- `Anchor` (the interface lands but no production impl).
- Any Cardano package (separate milestone, separate ADR if its surface
  warrants one).
- Credential resolution (the field is documented; resolution is a
  later concern).

This keeps the next ship small while preserving optionality.

## Consequences

**Positive:**

- Signing lands once, anchoring and credentialing land additively. No
  refactor of artifact-producing code when chain backends arrive.
- Runtime independence preserved. `flyway-core` never imports a chain
  SDK; chain code lives in optional packages that consumers install
  if they want.
- Source sovereignty preserved. Each Source chooses signer and anchor
  independently. No murmuration is forced onto a particular chain.
- Source-of-record stays GitHub. Anchoring is *additional* evidence,
  not a replacement for the repo as authoritative state.
- Andamio integration becomes a natural extension of the existing
  credentialing field, not a new protocol surface.
- The protocol stays nine tools. Chain integration is at the boundary,
  not in the tool count.
- Future ecosystem flexibility: someone can ship `flyway-solana`,
  `flyway-ethereum`, `flyway-bitcoin-anchor`, `flyway-ipfs` against
  the same interfaces. flyway does not pick a winner.

**Negative:**

- Extra abstraction in `flyway-core` for a feature whose only consumer
  on day one is the local default. Mitigated: the `Signer` indirection
  is one method-call wide and worth less than a refactor later.
- Async signing complicates code paths that today are synchronous.
  Mitigated: `flyway_init` and friends already cross an I/O boundary
  (writing files); going async is a small cost.
- Risk that flyway is *perceived* as a Cardano product because Andamio
  is co-developed by the Source. Mitigated by keeping all chain
  packages strictly optional, by this ADR's explicit framing, and by
  not adopting any chain-specific terminology in the core protocol.
- Key reuse footguns. Mitigated by docs, domain separation tags, and
  a confirmation prompt when explicitly opting in.

**Reversibility:** medium. The `Signer` interface is internal to
`flyway-core` and easy to evolve before it has external consumers.
The `Anchor` interface lands without an implementation, so revising it
is cheap. The on-disk shape of a signed artifact (a `signature` block
on canonical JSON) is consumer-facing once Sources start producing
signed entity statements — changes to that shape after v0.1 ship would
require a version bump and migration.

## Alternatives considered

1. **Bake Cardano signing directly into `flyway-core`.**
   Rejected. Violates ADR-0001's runtime independence principle and
   makes flyway un-shippable in environments where Cardano tooling is
   unavailable or unwanted. Also picks a chain winner the protocol has
   no business picking.

2. **Skip the signer abstraction; hard-code local Ed25519 and refactor
   later when Cardano lands.**
   Rejected on grounds of avoidable rework. The Signer interface is
   one method; the cost of designing it now is near-zero, the cost of
   retrofitting it later (across every artifact-producing function) is
   real.

3. **Treat anchoring as part of signing — a "signer" that also writes
   on-chain.**
   Rejected. Conflates two separable concerns. A Source may want a
   local signer with on-chain anchoring (fast signatures, durable
   provenance), or a Cardano signer with no anchoring (single-key
   custody, no transaction fees). The matrix is real; collapsing it
   would force false choices.

4. **Adopt a chain-specific DID method (e.g. `did:cardano`,
   `did:prism`) instead of, or alongside, `did:web`.**
   Rejected for v0.1. `did:web` keeps the system-of-record alignment
   with GitHub clean — the DID resolves to a file in the Source's
   repo. A chain-specific DID method would put authority in two places
   simultaneously. Re-evaluate if and when a `did:web`-resolution
   pain point emerges (e.g. GitHub takedowns, ranking attacks, etc.).
   Even then, multiple `verificationMethod` entries in the existing
   `did:web` document likely cover most use cases without changing the
   method.

5. **Wait — defer this ADR until we actually need Cardano signing.**
   Rejected because the forcing function is signing itself, which is
   imminent. We are about to make a one-way decision about whether
   `flyway-core` calls Node `crypto` directly or goes through an
   interface. We answer that now.

## Links

- [ADR-0001](./0001-project-framing-and-scope.md) — runtime independence and small protocol
- [ADR-0002](./0002-typescript-as-implementation-language.md) — TypeScript and Node `crypto`
- [ADR-0004](./0004-agent-skill-as-primary-protocol-interface.md) — skill is the surface, transports are adapters
- [ADR-0005](./0005-s3-patterns-as-canonical-protocol-vocabulary.md) — substance lives in S3; chain affordances are surface/transport
- [W3C Decentralized Identifiers v1.0](https://www.w3.org/TR/did-core/) — `verificationMethod`, key formats
- [CIP-30 — Cardano dApp-Wallet Web Bridge](https://cips.cardano.org/cips/cip30/) — likely wallet interface for `cardanoSigner`
- [CIP-25 / CIP-68 — Cardano metadata standards](https://cips.cardano.org/) — candidate anchor formats
- [Andamio](https://andamio.io) — on-chain trust and credentials, future `flyway-andamio` integration target

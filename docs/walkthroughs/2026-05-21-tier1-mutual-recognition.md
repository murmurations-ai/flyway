---
date: 2026-05-21
protocol-version: 0.1.0
code-sha: 1712232
kind: executable
tools-exercised: [flyway_init, flyway_recognize, flyway_status]
outcome: mutual recognition with cryptographically verified signatures on both sides
---

# Tier 1 — Mutual recognition

First **executable** walkthrough. Two independent murmurations create their
identities, verify each other's signed entity statements, and produce signed
recognition entries on each side. Every step runs real code, writes real
files, and produces signatures that round-trip through cryptographic verify.

This is the minimum unit of work that produces a demo where "two
murmurations talk to each other" is *literally true* and not a single-session
simulation. The 2026-05-13 walkthrough was narrative subagents reasoning
about a protocol that did not yet execute; this one is the protocol
executing.

## What this proves

| Claim | Evidence |
| --- | --- |
| Two cryptographically distinct identities can be produced. | `flyway init` in two directories yields two different Ed25519 keypairs and DIDs. |
| Each Source's identity is self-attesting via a signature over its entity statement. | `flyway/entity-statement.json` carries a `signature` block under `DOMAIN_ENTITY_STATEMENT`; verifies against the local DID document. |
| A Source can verify a peer's identity using nothing but the peer's published artifacts. | `flyway recognize <peer-path>` returns success only when peer's signature verifies. |
| Recognition is unilateral, signed, and binds the peer at a specific moment. | Each `peers.yaml` entry includes the peer's entity-statement fingerprint, the timestamp, and an EdDSA signature by the recognizer under `DOMAIN_RECOGNITION`. |
| Status reads on-disk recognition entries and verifies each one. | `flyway status` reports `Peers: 1 recognized` with `sig valid` per entry. Tampering with the recognition entry flips it to `sig INVALID`. |

## What this does NOT yet prove

- That recognition can be done **at a distance** (today only local-path peer
  fetch is wired; URL fetch is a separate milestone).
- That two murmurations can **exchange signals** (proposals, tensions,
  responses) — that needs Milestone S+2 (transport convention).
- That two murmurations can **reach consent** on an agreement and converge
  on byte-identical agreement YAML — that needs S+3.

## Setup

Both murmurations live in temp directories on a single machine. They are
otherwise fully independent — different DIDs, different keypairs, different
Sources. The two `flyway` invocations have no shared state beyond the
filesystem paths each was told about.

| Murmuration | DID                                       | Source | Mode        |
| ----------- | ----------------------------------------- | ------ | ----------- |
| A           | `did:web:github.com:xeeban:a`             | Nori   | interactive |
| B           | `did:web:github.com:emergent:praxis`      | Praxis | interactive |

## Reproducible script

The transcript below is verbatim from SHA `1712232`. To reproduce:

```bash
A=$(mktemp -d) && B=$(mktemp -d) && CLI=./packages/cli/dist/bin/flyway.js
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Nori")
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Praxis")
(cd "$A" && node "$CLI" recognize "$B" --note "First peer in the Tier 1 demo")
(cd "$B" && node "$CLI" recognize "$A" --note "Met via Nori's flyway")
(cd "$A" && node "$CLI" status)
(cd "$B" && node "$CLI" status)
```

## Transcript

### Step 1 — Initialize A

```
$ flyway init --repo-url https://github.com/xeeban/a --source-name "Nori"
Initialized flyway identity: did:web:github.com:xeeban:a
  wrote <A>/.well-known/did.json
  wrote <A>/flyway/entity-statement.json
  wrote <A>/flyway/keys/source.key
  updated .gitignore to exclude flyway/keys/
```

### Step 2 — Initialize B

```
$ flyway init --repo-url https://github.com/emergent/praxis --source-name "Praxis"
Initialized flyway identity: did:web:github.com:emergent:praxis
  wrote <B>/.well-known/did.json
  wrote <B>/flyway/entity-statement.json
  wrote <B>/flyway/keys/source.key
  updated .gitignore to exclude flyway/keys/
```

### Step 3 — A recognizes B

```
$ flyway recognize <B> --note "First peer in the Tier 1 demo"
Recognized did:web:github.com:emergent:praxis
  recognizedAt: 2026-05-21T14:19:12.214Z
  fingerprint:  V62ihUJnmAsy28lHAk99uXd6-ogzUmKdIYEFXd8GPTo
  wrote <A>/flyway/peers.yaml
  wrote <A>/flyway/peers/github.com/emergent/praxis/did.json
  wrote <A>/flyway/peers/github.com/emergent/praxis/entity-statement.json
```

What `flyway_recognize` did under the hood:

1. Loaded A's own DID document, signed entity statement, and private key
   from `<A>`.
2. Read B's DID document and entity statement from `<B>`.
3. Verified that B's entity statement signature checks out against B's DID
   document. (If this failed, recognition would abort.)
4. Hashed B's signed entity statement to produce `entityStatementFingerprint`.
5. Built an unsigned recognition entry binding B's DID, name, mode,
   fingerprint, and the timestamp.
6. Signed the entry with A's private key under `DOMAIN_RECOGNITION =
   "flyway-v1:recognition"`.
7. Appended the signed entry to A's `flyway/peers.yaml`.
8. Cached B's DID document and entity statement under A's
   `flyway/peers/github.com/emergent/praxis/`.

### Step 4 — B recognizes A

```
$ flyway recognize <A> --note "Met via Nori's flyway"
Recognized did:web:github.com:xeeban:a
  recognizedAt: 2026-05-21T14:19:12.320Z
  fingerprint:  JfLAKzlc_8gcCbWvowYV9tyavSJea3O9bDHXsKbqn-0
  wrote <B>/flyway/peers.yaml
  wrote <B>/flyway/peers/github.com/xeeban/a/did.json
  wrote <B>/flyway/peers/github.com/xeeban/a/entity-statement.json
```

The mirror image of Step 3, performed independently by B. **There is no
shared state between A's recognize and B's recognize.** Each Source acts on
the other's published artifacts.

### Step 5 — Status on A

```
$ flyway status
Identity: did:web:github.com:xeeban:a  (signature valid)
  Source:   Nori
  Mode:     interactive

Peers:    1 recognized
  - Praxis (did:web:github.com:emergent:praxis) — sig valid
Agreements: 0 on file
```

`sig valid` for the peer means: the recognition entry in `peers.yaml` was
signed by A (verifies against A's DID document), and its
`entityStatementFingerprint` matches what A originally hashed.

### Step 6 — Status on B (symmetric)

```
$ flyway status
Identity: did:web:github.com:emergent:praxis  (signature valid)
  Source:   Praxis
  Mode:     interactive

Peers:    1 recognized
  - Nori (did:web:github.com:xeeban:a) — sig valid
Agreements: 0 on file
```

## On-disk evidence

### A's `flyway/peers.yaml` after Step 3

```yaml
# flyway peers — peers this murmuration recognizes.
# Each entry is signed by this Source. Schema: flyway-peers-v0.
# Do not hand-edit signature fields; re-run `flyway recognize` instead.
schema: flyway-peers-v0
peers:
  - did: did:web:github.com:emergent:praxis
    sourceName: Praxis
    mode: interactive
    entityStatementFingerprint: V62ihUJnmAsy28lHAk99uXd6-ogzUmKdIYEFXd8GPTo
    recognizedAt: 2026-05-21T14:19:12.214Z
    recognizedBy: did:web:github.com:xeeban:a
    note: First peer in the Tier 1 demo
    signature:
      verificationKeyId: did:web:github.com:xeeban:a#key-1
      algorithm: EdDSA
      canonicalization: flyway-jcs-v1
      domain: flyway-v1:recognition
      signature: uGOvu5Rj5mIh9Hux7jok-ZBvdpwCH9hI8lAG8xrMtoPLG2Ry3Qp_SSQAuQ_JxpOjv9BNW6RyMzhHYxqoZFQDCw
```

### File tree at A after the demo

```
<A>/.gitignore
<A>/.well-known/did.json
<A>/flyway/entity-statement.json
<A>/flyway/keys/source.key                          (private; gitignored)
<A>/flyway/peers.yaml
<A>/flyway/peers/github.com/emergent/praxis/did.json
<A>/flyway/peers/github.com/emergent/praxis/entity-statement.json
```

B's tree is the mirror image with B/A swapped. Both repos can be browsed
independently; neither holds canonical state about the other.

## Cryptographic properties exercised

| Property | How it shows up | Where verified |
| --- | --- | --- |
| Self-attestation | Each entity statement signed by its own Source's key | `flywayInit` (signs at issuance), `flyway status` (verifies at read) |
| Peer attestation | Recognition entry signed by the recognizing Source, over the peer's identity at a specific fingerprint | `recognizePeer` (signs), `verifyRecognitionEntry` (verifies) |
| Domain separation | Distinct DOMAIN_* tags for entity statements and recognition entries; a recognition signature cannot be replayed as an entity-statement signature | `signing.ts` `domainSeparated()`; tested in `signing.test.ts` |
| Canonicalization | JCS-style sorted-keys JSON, no whitespace, `undefined` dropped | `canonicalize()` deterministic; tested across 8 cases |
| Tamper detection | Modifying any field in the entity statement or recognition entry breaks signature verification | `signing.test.ts` "tampered" cases; `status.test.ts` "tampered entity statement" case |

## Gaps surfaced

Some gaps are explicitly upcoming milestones rather than surprises:

- **No remote peer fetch.** `flyway_recognize` only accepts a local
  filesystem path. URL fetch + DID resolution come later. *(Not filing —
  known limitation, covered by future "remote fetch" milestone.)*
- **No signal transport between peers.** Recognition is the only
  cross-murmuration verb implemented; there is no inbox/outbox yet for
  proposals, tensions, responses. *(Not filing — this is Milestone S+2.)*

Genuinely new gaps worth filing as issues:

- **G1 — Peer public key not duplicated in `peers.yaml`.** Verifying a
  recorded recognition entry requires the recognizer's DID document (we have
  it locally). But verifying that the *cached* peer entity statement still
  matches what we hashed requires the peer's DID document too. The cache
  holds it, but a peer's `verificationMethod` rotation would invalidate the
  cache without an obvious signal. Storing the peer's public key inline in
  the `peers.yaml` entry would harden offline verification and make rotation
  detectable.

- **G2 — No `flyway_unrecognize` tool.** Recognition can be added with
  `--force` (replaces) but there is no first-class way to remove a peer. A
  Source must hand-edit `peers.yaml`, which the file header explicitly warns
  against. Symmetric to recognize: should produce a signed un-recognition
  attestation so the *act* of unrecognizing is itself a verifiable event.

- **G3 — Peer identity drift not surfaced.** If a peer rotates keys (or
  reissues their entity statement for any reason), the cached entity
  statement at `flyway/peers/<host>/<owner>/<repo>/` becomes stale. `flyway
  status` currently does not re-fetch or warn that the recorded
  `entityStatementFingerprint` no longer matches what the peer publishes
  today. This is a real soundness gap once peers are reachable remotely.

## Resolution of surfaced gaps

> *Added after the fact. The walkthrough body above is frozen at SHA*
> `1712232`; *this section records what changed downstream so readers can
> orient.*

All three gaps from the "Gaps surfaced" section were addressed in
SHA `f9911fd` (2026-05-21):

- **G1 closed.** `RecognitionEntry` now carries inline `peerPublicKey` and
  `peerVerificationKeyId`. The peer's key is part of the signed payload, so
  rotation is detectable from the entry alone.
- **G2 closed.** New CLI verb: `flyway unrecognize <peer-did> [--reason ...]`.
  Produces a signed unrecognition record under
  `flyway/unrecognized/<safe-did>.yaml` and removes the peer from
  `flyway/peers.yaml`. The peer cache is intentionally retained for audit.
- **G3 closed.** `flyway_status` now compares each recognition entry's
  bindings against the cached peer artifacts and reports drift
  (key rotation, statement reissue, or missing cache) as a per-peer
  issue.

## Links

- [`flyway_recognize` in flyway-core](../../packages/core/src/recognize.ts)
- [`runRecognize` in flyway-cli](../../packages/cli/src/recognize.ts)
- [`unrecognizePeer` in flyway-core](../../packages/core/src/recognize.ts)
- [`runUnrecognize` in flyway-cli](../../packages/cli/src/unrecognize.ts)
- [Architecture reference (markdown)](../architecture/how-flyway-works.md)
- [ADR-0007 — pluggable signers and on-chain anchoring](../adr/0007-pluggable-signers-and-anchors.md)
- Previous walkthrough: [2026-05-13 — Three-party retrospective cadence](./2026-05-13-3party-retrospective-cadence.md)

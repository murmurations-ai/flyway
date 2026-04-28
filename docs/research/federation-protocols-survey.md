# Federation & Coordination Protocols: A Comparative Survey for flyway

**Status:** Research input, not a decision document
**Audience:** flyway architecture working group (synthesis paper, strand 1 of 3)
**Author:** best-practices-researcher agent
**Date:** 2026-04-27

## 0. Framing

flyway is a coordination layer for AI-agent murmurations: groups of autonomous agents
running on different machines, controlled by different humans, each persisting its
authoritative state in GitHub. The unit of federation is the *murmuration*, not the
agent — a single party speaks for many agents. Humans are *Sources* (per the harness
identity model); GitHub is the system of record.

This survey asks: **what wire-level and conceptual primitives have other
federation/coordination protocols already worked out, and which of those are worth
borrowing?** It does not address governance theory or harness internals — those are
parallel strands.

I have direct working knowledge of ActivityPub, Matrix, IPFS/IPLD, Nostr, AT Protocol,
DIDComm, and Git federation. For Holochain, Solid, OpenID Federation,
murmurations.network, and Scuttlebutt I have working familiarity supplemented by
verification searches against current specifications (cited inline). I have flagged
the few places I am reconstructing rather than reciting.

## 1. Per-protocol breakdown

For each protocol, I extract: identity, discovery, transport, state authority,
conflict resolution, trust escalation, and operator agency.

### 1.1 ActivityPub (Mastodon, Pleroma, Lemmy, PeerTube)

W3C Recommendation, January 2018. The defining standard of the Fediverse.

- **Identity model.** Actors are URIs (typically `https://server/users/alice`). Each
  actor publishes a `publicKey` field. Server-to-server requests are authenticated by
  HTTP Signatures over the request line, `Date`, `Host`, and `Digest` headers, signed
  with the actor's key. There is no global identity; trust bootstraps from DNS + TLS.
- **Discovery.** WebFinger (`acct:alice@server`) for handle → actor URI lookup, then
  HTTP `GET` of the actor object for keys, inbox, outbox URLs.
- **Transport.** JSON-LD over HTTPS. Server-to-server delivery is `POST` to the
  recipient's inbox; client-to-server is `POST` to the actor's outbox. There is also a
  shared inbox optimisation for high-fanout deliveries.
- **State authority.** **Sender-authoritative.** The originating server is canonical
  for any object it produces. Other servers cache. An `Update` from a non-originating
  server for an object it doesn't own is ignored.
- **Conflict resolution.** Effectively none — last-writer-wins because only the
  authoritative server writes. Caches are eventually-consistent through `Update`,
  `Delete`, `Undo` activities. This is simple and works.
- **Trust escalation.** Per-instance defederation, blocklist sharing (informally —
  IFTAS-style efforts), keyword filters. No protocol-level reputation.
- **Operator agency.** Each instance unilaterally decides whom to federate with, what
  content to accept, and what to forward. Defederation is irreversible from the
  defederating side — you cannot be forced to receive.

### 1.2 AT Protocol (Bluesky)

In active IETF standardisation as of January 2026 (charter for the working group
published; repository and sync specifications targeted first).

- **Identity model.** DIDs — typically `did:plc:<base32hash>` (operated by the PLC
  Directory, currently being spun out of Bluesky into an independent organisation) or
  `did:web:<domain>`. A handle (`alice.bsky.social`) resolves to a DID via DNS TXT or
  HTTPS well-known. Handles are mutable; DIDs are stable.
- **Discovery.** Handle → DID via DNS/HTTPS, then DID document → service endpoints
  (PDS = Personal Data Server). Aggregators (AppViews like the Bluesky AppView)
  consume the firehose.
- **Transport.** XRPC over HTTPS — typed RPC where every call is named by a Lexicon
  NSID (e.g. `app.bsky.feed.getPostThread`). The "authority" for a Lexicon is rooted
  in the NSID being a transformed domain name, so namespaces are owned the same way
  domains are. Repository sync uses CAR files (IPLD content-addressed archives) over
  WebSockets for the firehose.
- **State authority.** **Repo-as-source-of-truth.** Each user's PDS holds a
  Merkle Search Tree (MST) of signed records. Every record is signed by the account's
  signing key (rotatable, stored in the DID document). If the PDS goes away, the
  signed CAR is portable and the user can move to another PDS without losing identity.
- **Conflict resolution.** Records are content-addressed and signed; there is no
  multi-writer conflict because each repo is single-writer (the account holder).
  Aggregators reconcile by replaying the firehose in commit order.
- **Trust escalation.** Labelers (composable moderation services that emit labels on
  records/accounts), AppView-level filtering, account-level mutes/blocks.
- **Operator agency.** Account holders own their repo and signing keys; can migrate
  PDSes without losing identity; can fork their AppView. Labelers can be subscribed to
  a la carte.

This is the protocol most aligned with flyway's "GitHub is the repo" model — see §3.

### 1.3 Matrix

- **Identity model.** `@user:server.example`. Servers federate via `X-Matrix` signed
  HTTP requests using ed25519 keys published at `/_matrix/key/v2/server`. Cross-signing
  for users layers device verification on top.
- **Discovery.** Server name resolution via `.well-known/matrix/server` and SRV
  records; rooms have IDs (`!opaqueid:server`) and optionally aliases
  (`#room:server`).
- **Transport.** JSON over HTTPS for federation API and client-server API; the
  federation API is sometimes called the "S2S API."
- **State authority.** **No single authority for room state.** Rooms are
  eventually-consistent DAGs. Every event names its `prev_events` and `auth_events`,
  forming a DAG that every participating server replicates.
- **Conflict resolution.** This is Matrix's signature contribution: **State Resolution
  v2** (and v2.1). When two servers' DAGs diverge, the algorithm uses reverse
  topological ordering (an adaptation of Kahn's algorithm) over the auth chain,
  preferring higher power-level events, to deterministically merge. Independent
  academic analysis exists; the algorithm is non-trivial but well-specified.
- **Trust escalation.** Per-server ACLs, room-level power levels (rich permission
  model), server-level ban lists (mjolnir/draupnir bots), federation allowlists.
- **Operator agency.** Homeservers can refuse to federate with peers; can leave any
  room; cannot be forced to host content. But once you join a room, you replicate its
  full DAG.

### 1.4 IPFS / IPLD

- **Identity model.** None at the protocol level — content addresses (CIDs) are the
  identifier. IPNS adds a mutable pointer keyed by a public key (effectively a
  one-writer keypair owns a stable name).
- **Discovery.** Kademlia DHT for content routing; CIDs as addresses; HTTP gateways
  for non-IPFS clients.
- **Transport.** libp2p (multistream over TCP/QUIC/WebRTC/WebTransport); Bitswap for
  block exchange.
- **State authority.** **Content-addressed.** A CID *is* the canonical identifier; if
  you have the bytes, they verifiably hash to the CID. There is no "owner" of a CID.
- **Conflict resolution.** Not applicable for immutable content. For mutable
  references (IPNS, OrbitDB-style CRDTs built atop IPFS), the application layer
  resolves.
- **Trust escalation.** None at protocol level; pinning services and gateway
  operators apply their own policies.
- **Operator agency.** Each node decides what to pin, what to serve, what to fetch.
  Garbage collection is local.

IPLD's contribution that's worth borrowing standalone: **DAGs as a universal data
model** (linked CBOR/JSON nodes addressed by hash). This is what AT Protocol's MST
and Git's object database both effectively are.

### 1.5 Solid (Tim Berners-Lee, Inrupt)

- **Identity model.** WebID — a URI (typically HTTPS) that dereferences to an RDF
  document containing the agent's public key and metadata. Authentication via
  Solid-OIDC (an OpenID Connect profile).
- **Discovery.** WebID URIs are shared out-of-band or via links from other linked-data
  resources; pod servers expose the LDP (Linked Data Platform) API.
- **Transport.** HTTP + LDP/RDF (Turtle, JSON-LD).
- **State authority.** **Pod-authoritative.** The user's pod holds their data; apps
  request access via OAuth-style consent. The pod is canonical.
- **Conflict resolution.** LDP semantics (PUT/PATCH); no built-in multi-writer CRDT.
  Applications must coordinate.
- **Trust escalation.** ACL/WAC (Web Access Control) on resources, controlled by the
  pod owner.
- **Operator agency.** The pod owner controls what apps see. Apps cannot retain
  copies of data without re-fetching unless the pod owner authorises persistence.

I am reconstructing some of this from general training; current Solid spec status has
moved over the years and I haven't verified against the latest draft.

### 1.6 OpenID Federation 1.0

OpenID Federation 1.0 reached Final status; 1.1 is in draft as of 2026.

- **Identity model.** Entities (which can be OPs, RPs, or intermediate authorities)
  identified by URLs. Each entity publishes an *Entity Configuration* — a self-signed
  JWT describing its keys, metadata, and *authority hints* (URLs of superior
  entities).
- **Discovery.** Trust chain resolution: starting from a leaf's Entity Configuration,
  fetch *Entity Statements* from its authority hints, and recurse upward until you
  reach a *Trust Anchor* (a pre-configured root). Each Entity Statement is a signed
  JWT issued by a superior about a subordinate.
- **Transport.** Signed JWTs over HTTPS at well-known endpoints.
- **State authority.** **Hierarchical.** Trust anchors are configured ahead of time
  by relying parties; intermediate authorities issue statements about their
  subordinates that may apply policy, restrict metadata, or revoke trust.
- **Conflict resolution.** Trust chain validation algorithm — newer/longer-lived
  statements take precedence per spec rules; intermediates can override leaf metadata
  via *Metadata Policy*.
- **Trust escalation.** *Trust Marks* — third-party assertions about an entity (e.g.
  "this RP has passed our security audit"). Composable.
- **Operator agency.** Each RP picks its trust anchors; each leaf entity picks its
  authority hints. Hierarchies are negotiated, not imposed.

This is the most directly applicable protocol for flyway's "how do murmurations
recognise each other" problem. It is also the most boring — which is a virtue.

### 1.7 Nostr

- **Identity model.** A secp256k1 keypair. The pubkey *is* the identity — no
  resolution, no DNS, no DID document. Events are signed with Schnorr signatures.
- **Discovery.** None at the protocol level. Users publish to relays of their choice;
  followers subscribe to those relays. NIP-05 (a verifiable handle via
  `.well-known/nostr.json`) is an optional convenience.
- **Transport.** WebSockets; events are JSON objects with `id`, `pubkey`, `created_at`,
  `kind`, `tags`, `content`, `sig` (per NIP-01).
- **State authority.** **Author-signed events; relays are dumb pipes.** Any relay can
  serve any event; the signature is what counts. Authors are expected to publish to
  multiple relays for redundancy.
- **Conflict resolution.** For mutable state (profile metadata, contact lists),
  newest-by-timestamp wins. For replaceable events (kind 0, kind 3), relays keep the
  latest per-pubkey-per-kind. No DAG, no CRDT.
- **Trust escalation.** Client-side filters, relay-side moderation policies, paid
  relays, reputation lists shared as Nostr events themselves.
- **Operator agency.** **Maximal.** Users can publish to any relay, run their own,
  switch instantly. Relays can refuse any event. Clients can choose any relay set.

Nostr's lesson is the value of **doing less.** The whole protocol is ~one page.

### 1.8 murmurations.network

(Distinct from our flyway-related "murmuration" metaphor; cited as a reference for
federated discovery.)

- **Identity model.** Nodes are identified by the URL where their JSON profile is
  hosted. No cryptographic identity.
- **Discovery.** **The Index API.** Nodes publish a JSON profile conforming to one of
  the schemas in the Murmurations Library; the index crawls/accepts profiles and
  exposes them to *aggregators* (which build maps, directories, etc.). Schemas are
  defined as JSON Schema and live in a public GitHub-hosted library; new fields go
  through a PR process.
- **Transport.** HTTPS for profile hosting, HTTPS API for the index and aggregators.
- **State authority.** **Profile host is canonical.** The index caches and validates
  against the schema; if the profile changes at source, the index re-crawls.
- **Conflict resolution.** N/A — profile owner is sole writer.
- **Trust escalation.** Schema validation; manual moderation of the index.
- **Operator agency.** Anyone can host a profile, anyone can run an index, anyone can
  build an aggregator. Multiple indexes are explicitly supported.

The relevant pattern for flyway: **schemas live in a shared repo, profiles live with
the operator, indexes are a thin lookup layer, aggregators do the interesting work.**

### 1.9 DIDComm v2

- **Identity model.** DIDs (any method). Messages are JWE (anoncrypt) or JWE+JWS
  (authcrypt) encrypted to the recipient DID's `keyAgreement` keys. Authcrypt uses
  ECDH-1PU (sender's static + recipient's static keys), which proves sender identity
  cryptographically; anoncrypt uses ECDH-ES (ephemeral sender key), which gives
  deniability.
- **Discovery.** Resolve recipient DID → DID document → service endpoints (often a
  mediator endpoint for receivers behind NAT or offline).
- **Transport.** Transport-agnostic. Any envelope that delivers bytes — HTTPS,
  Bluetooth, QR, email — can carry DIDComm. Mediators forward over HTTPS using a
  layered anoncrypt envelope so the mediator cannot see sender or content.
- **State authority.** N/A — DIDComm is a messaging protocol, not a state protocol.
  Higher-level protocols ("protocols" in DIDComm parlance) build state on top.
- **Conflict resolution.** Application layer.
- **Trust escalation.** Application layer, though DIDComm protocols often layer in
  Verifiable Credentials.
- **Operator agency.** Each party controls its keys; can rotate via DID document
  updates; mediators are user-chosen and fungible.

DIDComm is the **transport** primitive for "two autonomous parties exchange messages
without shared infrastructure." If flyway needs an off-GitHub channel (it probably
doesn't, see §3), DIDComm is the closest fit.

### 1.10 Web of Trust patterns (PGP, Keybase, Scuttlebutt/Manyverse)

- **PGP.** Keys signed by other keys; trust derived from signature graph + local
  trustdb (marginal/full trust). Discovery via keyservers (SKS, keys.openpgp.org).
  Famously hard to use; the WoT model is sound but the UX killed it.
- **Keybase (historical).** Tied keys to social identities (Twitter, GitHub, DNS,
  HTTPS) via verifiable proofs. The append-only signature chain per user was the
  innovation. Acquired by Zoom; the federated model effectively ended.
- **Scuttlebutt / Manyverse.** Each user is a signing keypair; each user has an
  append-only log of signed messages; messages are gossiped peer-to-peer (including
  over sneakernet). Discovery via *follows* — you only see logs of accounts your
  network follows. State authority is per-author log; conflict resolution is N/A
  because each log has one writer; trust is purely social.

The shared lesson: **append-only signed logs per principal + selective replication
based on social/follow graph.** This pattern shows up again in AT Protocol repos and
in Holochain source chains.

### 1.11 Holochain

- **Identity model.** Each agent generates a keypair; the public key is its identity
  in a given DNA (network/app instance).
- **Discovery.** DHT-based (sharded, validating). Agents find each other via the DHT
  for the DNA they share.
- **Transport.** Conductor-mediated; libp2p-style under the hood.
- **State authority.** **Dual: agent-centric source chain + validating DHT.** Every
  agent has their own append-only signed source chain (timestamps, sequence indices,
  authorship checked for consistency against the previous action). Public data is
  also published as DHT operations to a sharded DHT, where every storing node
  re-runs the DNA's validation rules before accepting.
- **Conflict resolution.** Validation rules are deterministic and run by every
  validator. Operations that fail validation are rejected; if an agent persists in
  publishing invalid data, they are *warranted* — every node in the network is
  notified and can refuse further interaction. This is sometimes called the
  "immune system" response.
- **Trust escalation.** Built into validation rules. The DNA hash is the social
  contract: if you joined the network you accepted the rules, and breaking them
  ejects you.
- **Operator agency.** Each agent runs their own conductor. They cannot be forced to
  store data they reject or to gossip with peers they don't want to.

Holochain is the most theoretically interesting match for flyway: agent-centric
authority + shared validation rules + automatic ejection of bad actors. In practice,
the Holochain runtime is heavy and has not seen wide adoption, but the **conceptual
model** (every party has its own signed log; shared rules govern what counts as
valid; bad-faith parties are warranted out) is exactly the model flyway is reaching
for.

### 1.12 Federation in Git itself

Often overlooked because it's not branded as a federation protocol, but Git is
arguably the most successful federated coordination protocol in software.

- **Identity model.** GPG/SSH-signed commits and tags; commit author and committer
  fields. No global identity; trust comes from out-of-band signature verification (or
  GitHub's "Verified" badge, which delegates to attached keys).
- **Discovery.** Out-of-band — clone URLs are shared via web pages, READMEs, etc.
- **Transport.** Git wire protocol over SSH/HTTPS, or dumb HTTP, or sneakernet (a USB
  stick of pack files works). The protocol is just object exchange.
- **State authority.** **Repo-local.** Every clone is a full peer. Each fork is
  authoritative for itself. Pull requests are *proposals* — the receiving repo's
  maintainer chooses to merge.
- **Conflict resolution.** Three-way merge with manual conflict resolution. The DAG
  is the source of truth; merges produce new commits that reconcile divergence.
- **Trust escalation.** Maintainer review, signed commits, branch protection, CI
  gates. Bad-faith forks are simply not merged.
- **Operator agency.** **Maximal.** Anyone can fork; nobody can be forced to merge;
  history is portable.

The combination Git + GitHub adds: a centralised hub for discovery and review (which
operators choose to use, and could replace), but the underlying protocol stays
federated. flyway's choice of GitHub-as-system-of-record sits exactly on this seam.

## 2. Comparative tables

### 2.1 Identity & discovery

| Protocol | Identity | Discovery | Cryptographic? |
|---|---|---|---|
| ActivityPub | URI + HTTP key | WebFinger | Per-actor key |
| AT Protocol | DID (PLC/web) + handle | DNS/HTTPS → DID doc | Per-account signing key |
| Matrix | `@user:server` | `.well-known` + SRV | ed25519 server keys |
| IPFS | CID (content) / IPNS key | Kademlia DHT | Hash-as-identity |
| Solid | WebID URI | Out-of-band + linked data | OIDC + WebID |
| OpenID Fed | Entity URL | Trust chain via authority hints | JWT signing keys |
| Nostr | secp256k1 pubkey | None (relay-of-choice) | Schnorr sig |
| Murmurations | Profile URL | Index API | None |
| DIDComm | DID | DID resolution | Per-DID keys |
| Scuttlebutt | ed25519 pubkey | Follow graph | Per-feed sig |
| Holochain | Agent pubkey per DNA | DHT | Per-agent + DNA hash |
| Git | Commit signature | Out-of-band clone URL | GPG/SSH (optional) |

### 2.2 State authority & conflict resolution

| Protocol | Authority | Conflict resolution |
|---|---|---|
| ActivityPub | Sender (originating server) | Last-writer-wins via Update/Delete |
| AT Protocol | Account's repo (single-writer) | None needed; aggregators replay firehose |
| Matrix | Distributed DAG (all participating servers) | State Resolution v2 (deterministic merge) |
| IPFS | Content-addressed (no owner) | N/A for immutable; app-level for IPNS |
| Solid | Pod owner | LDP semantics; no multi-writer support |
| OpenID Fed | Trust chain (hierarchical) | Trust chain validation rules |
| Nostr | Author-signed; relays are pipes | Newest-timestamp for replaceable events |
| Murmurations | Profile host | N/A (single writer) |
| DIDComm | N/A (transport only) | N/A |
| Scuttlebutt | Per-feed append-only log | N/A (single writer per feed) |
| Holochain | Agent source chain + DHT validation | Deterministic validation rules; warrant on violation |
| Git | Repo-local; PR proposals | Three-way merge |

### 2.3 Operator agency

| Protocol | Can refuse peers? | Portable identity? | Self-host trivial? |
|---|---|---|---|
| ActivityPub | Yes (defederation) | Hard (handle tied to instance) | Medium |
| AT Protocol | Yes (block peer servers) | **Yes** (DID + signed CAR) | Medium |
| Matrix | Yes (server ACLs) | Hard (MXID tied to homeserver) | Medium |
| IPFS | Yes (peer block) | Yes (you own the keys) | Easy |
| Solid | Yes (ACL) | Yes (move pod) | Medium |
| OpenID Fed | Yes (refuse trust anchor) | Yes (re-key) | Hard |
| Nostr | Yes (relay choice) | **Yes** (just keys) | **Trivial** |
| Murmurations | Yes (refuse to index) | Yes (move profile) | Easy |
| DIDComm | Yes (DID rotation) | Yes (DID method permitting) | Medium |
| Scuttlebutt | Yes (unfollow) | Yes (just keys) | Trivial |
| Holochain | Yes (refuse gossip) | Yes (per DNA) | Medium |
| Git + GitHub | Yes (don't merge) | **Yes** (clone, push elsewhere) | Trivial |

## 3. Synthesis

### 3.1 Common primitives — flyway must-haves

Across nearly every protocol surveyed, the following primitives recur. flyway will
need each of them in some form:

1. **Stable cryptographic identity per party.** Every protocol that lets autonomous
   parties communicate has some form of "this party owns this keypair." For flyway,
   the murmuration is the party. The only outliers are Murmurations.network (no
   crypto) and Git-without-signed-commits (crypto optional). Both are fine when the
   stakes are low; flyway's stakes (agents acting on behalf of humans) are not low.

2. **Stable identifier separable from current host.** ActivityPub's pain (handle
   tied to instance) is the cautionary tale; AT Protocol DIDs, Nostr pubkeys, IPFS
   CIDs, Holochain agent keys, and Git repos all separate "who" from "where." flyway
   should make sure murmuration identity survives a GitHub org rename, a fork, or a
   migration to another host (Codeberg, Gitea, self-hosted).

3. **Discovery via a thin lookup layer plus rich aggregators.** Murmurations.network
   and AT Protocol's PDS/AppView split express the same idea: keep the index dumb,
   let aggregators be opinionated. ActivityPub's WebFinger is thin lookup; the
   timeline rendering is the aggregator. flyway should resist baking discovery
   semantics into the protocol.

4. **Append-only signed log per party.** Scuttlebutt feeds, Holochain source chains,
   AT Protocol repos, Git's commit history, even Keybase's signature chain — every
   protocol that handles real disagreements has each party keeping a signed,
   append-only record of its own actions. GitHub already gives flyway this for free
   (commits, issue comments, PRs are all timestamped and attributable).

5. **Operator agency as a first-class invariant.** Every protocol surveyed lets each
   party refuse peers, refuse content, and walk away. This is not a feature, it is
   the *definition* of federation. Any flyway design that lets one murmuration force
   another to accept a directive, agent, or merge has stopped being federation.

### 3.2 Protocol-specific primitives — flyway design choices

These are decisions flyway must make, and the protocols disagree:

1. **State authority model.** Three viable shapes:
   - **Sender-authoritative caching** (ActivityPub) — simple, but requires
     explicit Update/Delete activities and tolerates inconsistency.
   - **Repo-as-source-of-truth** (AT Protocol, Git) — single-writer per object,
     content-addressed, signed. Aligns with flyway's "GitHub is system of record."
   - **Distributed DAG with deterministic merge** (Matrix, Holochain) — works for
     true multi-writer state, but expensive and complex.

   *flyway is firmly in the second camp. GitHub already gives us repo-as-source-of-truth.*

2. **Discovery mechanism.** DNS-rooted (ActivityPub, AT Protocol handles, OpenID
   Federation), DHT (IPFS, Holochain), or out-of-band (Nostr, Scuttlebutt, Git). For
   flyway, GitHub URLs are already a well-known, dereferenceable identifier — DNS-
   rooted by transitivity, no DHT needed.

3. **Trust hierarchy vs. trust graph vs. trust anarchy.** OpenID Federation is
   hierarchical (trust anchors). PGP/Scuttlebutt are graph-based (web of trust).
   Nostr is anarchic (relay-and-client choice). For flyway's case — a small number of
   murmurations that mostly know about each other — a hybrid is appropriate: each
   murmuration explicitly lists the murmurations it recognises (graph), with optional
   shared trust anchors (e.g., a "flyway directory" that any murmuration can publish
   to but none must consult).

4. **Conflict resolution model.** Matrix State Res v2 is the gold standard for
   distributed agreement, but flyway probably never needs it: if GitHub is each
   murmuration's source of truth, then *cross-murmuration* state is always one-way
   (murmuration A reads murmuration B's repo; B's repo is canonical for B's state).
   The only place conflict arises is when two murmurations claim authority over the
   same object — and the protocol-level answer should be "they can't" (every object
   has exactly one home repo).

5. **Trust escalation.** ActivityPub-style defederation, Matrix-style ACLs,
   Holochain-style automatic warrants, Nostr-style relay/client filtering. flyway
   should default to the simplest viable: each murmuration maintains an explicit list
   of recognised peers, and removal is a unilateral action.

### 3.3 Closest-fit analysis

Ranked by how closely each protocol matches flyway's setup (independent murmurations,
GitHub-authoritative state, human Sources, agent populations):

1. **Git federation (with signed commits) + AT Protocol-style identity.** The
   strongest match. Each murmuration is essentially a Git repo with autonomous
   computation attached. PRs across forks are exactly the cross-murmuration
   coordination primitive. GitHub provides the discovery hub the same way Bluesky's
   AppView provides one for AT Protocol — useful but not load-bearing.

2. **AT Protocol.** Repo-as-source-of-truth, signed records, content-addressed
   history, portable identity, separation of "where data lives" from "what reads it."
   This is the closest *named* protocol. The principal differences: flyway uses
   GitHub instead of a custom MST/PDS, and flyway's "record" is a richer object
   (issue + comments + labels + commits) than AT Protocol's flat record.

3. **Holochain.** Agent-centric authority + shared validation rules is conceptually
   exactly what flyway wants for "what counts as a legitimate murmuration action."
   Borrow the *concept* (rules of the game live in code shared across parties; bad-
   faith violators are warranted out), skip the runtime.

4. **OpenID Federation 1.0.** When (not if) flyway needs to express "these
   murmurations are part of the same federation, here's the metadata, here's how to
   verify a peer is who they claim to be," OpenID Fed's entity statements + trust
   chains are the most production-tested model in software. Borrow the data model
   directly: signed JWTs of metadata, authority hints, optional trust marks.

5. **Murmurations.network's discovery model.** Borrow the schema-library-as-Git-repo
   pattern for cross-murmuration data formats. Schemas live in a shared repo; each
   murmuration declares which schemas it implements; aggregators (e.g., a flyway
   directory) consume from many.

6. **Nostr.** Borrow the philosophy of *minimalism* and *operator-chosen relays.* The
   protocol you don't write is the protocol you don't have to maintain.

7. **Matrix, ActivityPub, IPFS, Solid, DIDComm, Scuttlebutt.** Useful as references
   for specific sub-problems (e.g., DIDComm if flyway ever needs out-of-band
   secure messaging between humans-controlling-murmurations) but not closest-fit.

### 3.4 Concrete recommendations for flyway

Phrased as the requested "flyway should adopt X from protocol Y because…" form.

1. **flyway should adopt repo-as-source-of-truth from AT Protocol and Git, because
   it eliminates an entire class of consensus problems.** Each murmuration's GitHub
   repo is canonical for its state. Other murmurations cache and dereference; they
   never overwrite. Cross-murmuration state changes happen via PR (mutual
   coordination) or via reading the other's repo (one-way subscription). This rules
   out Matrix-style state DAGs and Solid-style multi-writer pods as
   over-engineered for flyway's needs.

2. **flyway should adopt signed-commit + signed-action identity from Git, lifted
   toward DIDs from AT Protocol.** Short-term: every murmuration action is a Git
   commit signed by a key the murmuration controls. Medium-term: introduce a
   `did:web` DID document hosted at the murmuration's repo (e.g. `/.well-known/
   did.json`) so identity is portable across hosts. This buys the operator-agency
   property of AT Protocol (move murmurations between GitHub and Codeberg without
   losing identity) without inventing a new identity protocol.

3. **flyway should adopt an OpenID Federation-style entity statement for
   murmuration metadata, because it is the most boring and battle-tested model for
   "here's a signed JSON document about who I am, what I federate with, and what my
   policies are."** A flyway entity statement could be a single signed JSON file in
   each murmuration's repo (`.flyway/entity-statement.json`) listing: the
   murmuration's DID, public key, governance plugin, peer murmurations it
   recognises, and pointers to any trust anchors it consults. This is the protocol
   that does the most work for the least design effort.

4. **flyway should adopt the Murmurations.network pattern of schemas-as-shared-repo
   for any cross-murmuration data format.** A `flyway-schemas` repo holds the
   canonical JSON Schemas for entity statements, peer announcements, directives, and
   any other inter-murmuration message types. New schemas land via PR. Each
   murmuration declares which schema versions it speaks. This gives flyway
   evolution-of-protocol-without-a-central-server.

5. **flyway should adopt thin discovery from the AT Protocol + Murmurations split:
   GitHub URL is the lookup, an optional aggregator builds the experience.** A
   minimal `flyway directory` could be a separate GitHub repo whose `README.md`
   lists known murmurations (each as a row pointing at their repo + entity
   statement). Murmurations can submit themselves via PR; the directory maintainer
   accepts or doesn't; murmurations can run their own directories. Aggregators
   (status pages, dashboards, search) read from one or more directories. This is
   how Murmurations.network already works, and how the ActivityPub fediverse
   informally works through sites like fediverse.observer.

6. **flyway should adopt Holochain's "rules of the game live in shared code"
   conceptually, expressed via TypeScript packages rather than DNAs.** The harness
   already does this — `@murmurations-ai/core` and the governance plugins define
   what counts as a valid wake, action, or transition. flyway's contribution is
   to make this *the federation contract*: two murmurations can interoperate iff
   they speak compatible versions of the same packages. Schema versions in entity
   statements make this checkable.

7. **flyway should adopt Nostr's minimalism principle: every primitive that can be
   pushed up to the operator is a primitive flyway does not need to ship.** No
   protocol-level reputation system; operators block and unblock. No protocol-level
   moderation; operators decide what to read. No mandatory aggregator; operators
   consult whichever directory they trust. The smaller the protocol, the more it
   federates.

8. **flyway should explicitly *not* adopt Matrix-style distributed state
   resolution, ActivityPub-style sender-authoritative caching for non-cache-able
   data (governance state), or DHT-based discovery (Holochain, IPFS).** GitHub
   solves the distribution problem; the cost of replicating it is not justified by
   the threat model.

### 3.5 Risks and open questions for the synthesis paper

A few things this strand of research surfaces but cannot resolve alone:

- **Does flyway need a transport beyond GitHub?** If two murmurations want to
  exchange short-lived signals (e.g. "I'm convening a cross-group meeting in 5
  minutes, please send a delegate"), GitHub issues feel heavy. DIDComm or a shared
  Matrix room are alternatives. Defer; GitHub-first is fine for v1.
- **What is the threat model when a murmuration is captured?** If the human Source
  for murmuration A is compromised, the agents will sign actions A's peers will
  accept. Holochain's warrant model assumes peers can verify; flyway's GitHub-based
  model has only social verification (other Sources notice and revoke). This is a
  governance-theory question, not a protocol question.
- **How does identity rotate?** AT Protocol has signing key rotation via DID
  document updates; Git has no good story. flyway needs to decide early.
- **Schema evolution.** Murmurations.network handles this with versioned schemas in
  the library + per-profile `linked_schemas` arrays. flyway should adopt the same.

## 4. References

I have cited specifications/RFCs where possible; flagged where reconstructing.

**Verified during this research:**

- ActivityPub: W3C Recommendation, January 2018. Actors, inbox/outbox, HTTP
  Signatures for S2S confirmed via W3C primer pages.
- AT Protocol: IETF working group chartered January 2026; Lexicon NSIDs rooted in
  domain names; PLC Directory transitioning to independent operation. Confirmed via
  Bluesky docs and IETF charter.
- Matrix State Resolution v2: reverse topological ordering via Kahn's algorithm
  adaptation; auth chain DAG; v2.1 implementer's guide exists. Confirmed via
  matrix.org spec and Synapse docs.
- Holochain: agent-centric source chain + sharded validating DHT; warrants for
  invalid operations. Confirmed via developer.holochain.org concepts pages.
- Murmurations.network: JSON Schema library on GitHub, Index API, aggregator model.
  Confirmed via docs.murmurations.network.
- OpenID Federation 1.0: Final status reached; entity statements as signed JWTs;
  trust chain resolution via authority hints; trust marks. Confirmed via
  openid.net spec.
- DIDComm v2: authcrypt (ECDH-1PU) vs anoncrypt (ECDH-ES); mediator forwarding via
  layered anoncrypt envelope. Confirmed via identity.foundation editor's draft.
- Nostr NIP-01: Schnorr signatures over secp256k1; events with id/pubkey/created_at/
  kind/tags/content/sig; relays as dumb pipes. Confirmed via nips.nostr.com.

**Working knowledge, not freshly verified:**

- IPFS/IPLD architecture (libp2p, CIDs, Bitswap, IPNS). Citing from general training.
- Solid (WebID, Solid-OIDC, LDP, WAC). Citing from general training; specific spec
  versions not verified.
- Scuttlebutt (per-feed signed log, follow-graph replication). General training.
- Keybase pre-acquisition signature chain model. General training.
- Git wire protocol details. Working knowledge from regular use.
- PGP web of trust (key signing, trustdb). General training.

I have not fabricated any specifications, but where I have not freshly verified, the
reader should expect ~5-year-old accuracy at best.

## 5. One-paragraph TL;DR for the synthesis paper

flyway should treat each murmuration as a Git repo (already true) with a stable DID
(`did:web` resolved from `.well-known/did.json` in the repo), a signed entity
statement borrowed from OpenID Federation, schemas in a shared repo borrowed from
Murmurations.network, peer recognition as a per-murmuration list (graph trust,
optional shared anchors), and discovery via a thin GitHub-hosted directory plus
operator-run aggregators. State authority is always repo-local; cross-murmuration
state changes happen via PR or one-way read; conflict resolution at the protocol
level is unnecessary because no two murmurations share authority over the same
object. The protocols to steal from most heavily, in order, are: Git federation
itself, AT Protocol (identity + repo-as-truth), OpenID Federation (entity statements
+ trust chains), Murmurations.network (schemas + index/aggregator split), and
Holochain (rules-of-the-game-live-in-shared-code). The protocols to *not* copy are
Matrix (over-engineered for flyway's threat model), ActivityPub's handle-bound
identity (the worst footgun in the survey), and DHT-based discovery (unjustified
operational cost). The single most important invariant is operator agency: every
party retains unilateral control over what it accepts, what it forwards, and whom it
recognises. Anything that violates that has stopped being federation.

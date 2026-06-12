# Multi-murmuration collaboration: a research paper for flyway

**Author:** Source (Nori / Kozan), with research strands by best-practices-researcher agents and code audit
**Date:** 2026-04-27
**Status:** Research output, not a decision document. Consumed by future ADRs.

> **Amendment, 2026-04-27 (same day):** Original draft assumed every flyway participant runs the murmurations-harness. Source clarified this is too narrow — a "murmuration" is *any agent swarm controlled by a Source*, and flyway must support participants regardless of runtime: harness installations, Claude Code sessions, Cursor / IDE plugins, OpenClaw agents reached via chat, raw-GitHub manual users, and tools yet to exist. The paper has been amended throughout to reflect this; the most concentrated changes are in §6 (Architecture) and a new §6.5 (Participation modes & client integrations). The recommended MVP has shifted from "two harness installations" to "one harness + one Claude Code session" as a deliberate cross-runtime demonstration.

---

## Abstract

flyway is the protocol that lets `n` independent AI-agent murmurations collaborate while each retains full autonomy. A *murmuration* is any agent swarm controlled by a Source — a human operator. The murmurations-harness is one way to operationalize a murmuration, but not the only way: a Source running Claude Code with sub-agents, a developer using Cursor, an OpenClaw agent reached through a chat client, or even a person scripting against GitHub directly are all equally valid participants. flyway is runtime-agnostic by design.

This paper synthesizes three parallel research strands (federation protocols in software, decentralized governance theory, and the murmurations-harness's existing extension surface) into a recommended shape for flyway. The conclusion: flyway is small. It is a thin protocol on top of primitives that already exist (Git, GitHub, signed commits, S3 governance). Its load-bearing contributions are *not* novel infrastructure — they are an explicit handshake protocol between murmurations, a small set of shared schemas, a discipline of treating "no joint action" as a first-class outcome when Sources disagree, and a runtime-agnostic protocol surface so participants can join from any tool. Most of the design work is choosing what *not* to build.

The paper proposes:

- **Identity:** `did:web` resolved from each murmuration's repo, with a signed entity statement borrowed from OpenID Federation. Identity is anchored to a Source-controlled repo, not to any specific runtime.
- **Discovery:** thin GitHub-hosted directories + operator-run aggregators, borrowed from Murmurations.network.
- **Trust:** explicit pairwise recognition; per-pair engagement agreements committed to both repos.
- **Governance:** S3 as the default for inter-murmuration consent, pluggable per agreement; "lazy consent" for routine matters; explicit goal lifecycles; structured exit terms.
- **Architecture (revised):** a runtime-agnostic protocol layer + a reference TypeScript core (`@murmurations-ai/flyway-core`) + a family of client integrations: harness adapter, CLI, Claude Code skill, generic MCP server (Cursor and other MCP-capable tools), and documented patterns for chat clients and web UI. Any client that can read/write GitHub, sign artifacts, and verify peer signatures is a first-class participant.
- **Participation modes:** persistent (always-on daemon), interactive (Source actively at their tool), asynchronous (GitHub-only), and ephemeral (one-shot Claude Code or CLI participation). All four modes are valid; agreements may require specific modes when warranted.
- **MVP (revised):** mirrored cross-murmuration directives between **one harness installation and one Claude Code session**, demonstrating the cross-runtime story end-to-end.

The paper also surfaces five questions that cannot be answered by research alone and need design choices: identity-rotation strategy, schema-evolution strategy, threat model when a Source is captured, cost attribution between cooperating murmurations, and whether flyway needs an off-GitHub transport.

---

## 1. Problem statement

### 1.1 What we mean by "multi-murmuration collaboration"

A *murmuration* is any agent swarm controlled by a Source. The murmurations-harness is the canonical operationalization — one daemon, one Source, one repo, agents waking on signals — but it is one of several. Equally valid murmurations include:

- A Source running **Claude Code** with a portfolio of sub-agents and long-running agent tasks
- A developer using **Cursor** (or another MCP-capable IDE) with embedded agent tooling
- An **OpenClaw agent** reached through a chat client (Discord, Telegram, Slack)
- A Source scripting agents directly against the **Anthropic / OpenAI / Gemini APIs**, with state in any repo
- A Source using just **GitHub** — manually orchestrating issues, PRs, and signed commits with no autonomous agents at all

The unifying property is not the runtime. It is *a Source whose authority is anchored at a Git-addressable repo with a stable identity, who speaks for whatever agents (or only themselves) they are operating.* flyway is the protocol that lets such Sources collaborate.

Today there is no protocol for this. Each Source's tooling is closed within their own session or installation. Multi-murmuration collaboration, then, is the work that happens between any two or more such Sources.

The harness is explicitly *single-murmuration* by ship bar — its `CLAUDE.md` declares "multi-murmuration coordination is out of scope for v0.1." Other tools (Claude Code, Cursor, OpenClaw) similarly do not assume cross-instance coordination. flyway adds it without requiring any of them to change.

Multi-murmuration collaboration, then, is the work that happens between any two or more such systems. Concretely:

- Sometimes there's a **specific shared project** — two murmurations want to publish a paper jointly, run a campaign together, co-develop a software library, or share research. The collaboration has a clear scope, a clear goal, and a clear endpoint.
- Sometimes there's an **ongoing relationship** at the organizational level — two murmurations that find themselves repeatedly working together choose to formalize a longer-term arrangement (call it a *syndicate*): shared schemas, shared protocols, regular alignment touchpoints, mutual governance representation.
- Sometimes there's just **discovery** — Murmuration A learning that Murmuration B exists, what it does, and whether they should ever talk.

The user's brief asks all three questions in scope. The answers turn out to differ in process but share substrate: every collaboration mode reduces to a small set of primitives layered over each murmuration's existing GitHub-as-system-of-record posture.

### 1.2 What's at stake

Four properties must hold no matter what flyway does:

1. **Operator agency.** Each murmuration's Source retains unilateral authority over: who they federate with, what content they accept, what their agents do, and whether to exit any collaboration at any time. This is the load-bearing invariant. Anything that violates it has stopped being federation and started being submission.
2. **Runtime independence.** flyway must not assume a specific runtime. A Source running the harness, a Source running Claude Code, and a Source manually using GitHub must all be first-class participants. The protocol surface lives at the Git/GitHub layer, not at any one tool's API.
3. **Harness sovereignty.** The harness ships and runs as a single-murmuration runtime with no flyway dependency. Operators who never touch flyway must continue to have a complete experience. (This is a special case of property 2 — the harness happens to be the project's own primary runtime, but it gets no privileged status in flyway.)
4. **Honesty about disagreement.** When Sources cannot agree, the answer is *no joint action*. flyway must not pretend to manufacture agreement. The empirical lesson from Ostrom's commons literature, from Apache's lazy-consent practice, and from S3 itself is that voluntary cooperation that respects exit is more stable than forced agreement.

### 1.3 What "good" looks like

A first-class flyway primitive lets two or more autonomous murmurations:

- discover each other (or be told about each other)
- recognize each other cryptographically
- agree on the rules of engagement before engaging
- run a structured collaboration (project or syndicate) within those rules
- exit cleanly when the work is done or when the relationship breaks down

If those five steps are smooth, flyway has done its job. If any of them require a third party with authority over either Source, flyway has overreached.

---

## 2. What the murmurations-harness already gives us

flyway does not start from zero. The harness's existing primitives — accumulated through ADRs 0001–0033 — are the substrate flyway extends.

| Primitive | Where | What flyway uses it for |
|---|---|---|
| `IdentityChain` (`packages/core/src/identity/`) | role.md + soul.md per agent | Add peer-murmuration identity context per wake |
| Signal aggregator (`packages/signals/src/`) | per-wake bundle | Inject federation-event signals; route via CollaborationProvider |
| Directives (`packages/cli/src/directive.ts`) | GitHub issues with `source-directive` label | Mirror across repos for cross-murmuration asks |
| GovernancePlugin (`packages/core/src/governance/`) | model-agnostic interface | Federation governance plugin composes with each side's S3 plugin |
| Group meetings (`packages/core/src/groups/`) | facilitator-led structured rounds | Cross-murmuration meeting = synchronized pair of group meetings |
| **CollaborationProvider** (ADR-0021) | pluggable backend (GitHub, local) | **Primary integration seam** — flyway implements a federation provider |
| GitHub mutations (ADR-0017) | scope-enforced writes | Compose into mirrored-issue and shared-PR primitives |
| Spirit (ADR-0024) | operator companion + skills | flyway-side operator commands (`:flyway peers`, `:flyway propose`) |
| Extensions (ADR-0023) | per-agent declared tools | Federation tools agents can opt into per role.md |
| Cost record (ADR-0011) | per-wake instrumentation | Attribute federation cost via custom dimensions |
| Wake actions (`packages/core/src/execution/`) | structured agent output → harness mutations | Add federation action kinds; route via existing handler-extension pattern |
| Directory layout (ADR-0026) | canonical operator repo structure | Add `flyway/` directory for peers, agreements, cache |

The full primitives audit is in `harness-primitives-audit.md` in this directory. The headline finding: the harness's `CollaborationProvider` interface (ADR-0021) is the seam designed for exactly this kind of work. flyway's principal contribution is a `FederationCollaborationProvider` that wraps multiple per-repo providers and emits federation signals.

---

## 3. What other federation protocols teach us

The federation-protocols survey (`federation-protocols-survey.md` in this directory) covers ActivityPub, AT Protocol, Matrix, IPFS, Solid, OpenID Federation, Nostr, DIDComm, Holochain, Murmurations.network, Web of Trust patterns, and Git itself. The full document is ~6,800 words. Distilled to actionable lessons for flyway:

### 3.1 Five primitives recur across nearly every protocol

If a federation protocol has been used in production, it has these:

1. **Stable cryptographic identity per party.** Every protocol that lets autonomous parties communicate makes some form of "this party owns this keypair" load-bearing. flyway needs the same.
2. **Stable identifier separable from current host.** ActivityPub's worst footgun was binding handles to instances; AT Protocol DIDs, IPFS CIDs, Nostr pubkeys, and Git repos all separate "who" from "where." flyway's identifier must survive a GitHub org rename, a fork, or migration to Codeberg/Gitea.
3. **Discovery via a thin lookup layer plus rich aggregators.** Murmurations.network and AT Protocol's PDS/AppView split express the same idea: keep the index dumb, let aggregators be opinionated. flyway should resist baking discovery semantics into its protocol.
4. **Append-only signed log per party.** Scuttlebutt, Holochain source chains, AT Protocol repos, Git's commit history. Every protocol that handles real disagreements has each party keeping a signed, append-only record. GitHub gives flyway this for free.
5. **Operator agency as a first-class invariant.** Every surveyed protocol lets each party refuse peers, refuse content, and walk away.

### 3.2 The closest fits to flyway's setup

Ranked by structural similarity to "independent murmurations, GitHub-authoritative state, human Sources, agent populations":

1. **Git federation with signed commits + AT Protocol-style identity.** The strongest match. Each murmuration *is* essentially a Git repo with autonomous computation attached. PRs across forks are exactly the cross-murmuration coordination primitive.
2. **AT Protocol.** Repo-as-source-of-truth, signed records, content-addressed history, portable identity. The closest *named* protocol. Differences: flyway uses GitHub instead of a custom MST/PDS, and flyway's "record" is richer (issue + comments + labels + commits) than AT Protocol's flat record.
3. **Holochain.** Borrow the conceptual model — agent-centric authority + shared validation rules + automatic warrant of bad actors — even though the runtime is too heavy.
4. **OpenID Federation 1.0.** The most boring and battle-tested model for "signed metadata about who I am, what I federate with, and what my policies are." Borrow the entity-statement data model directly.
5. **Murmurations.network.** Borrow the schemas-as-shared-Git-repo + thin-index + opinionated-aggregator pattern.
6. **Nostr.** Borrow the *minimalism principle*: the protocol you don't write is the protocol you don't have to maintain.

### 3.3 What to explicitly *not* copy

- **Matrix-style distributed state resolution.** GitHub already handles distribution. Replicating it would buy nothing.
- **ActivityPub's handle-bound identity.** The worst footgun in the survey.
- **DHT-based discovery** (Holochain, IPFS). Operationally heavy; not justified by flyway's threat model.

### 3.4 The single most important architectural choice

**Repo-as-source-of-truth, one writer per object.** Each murmuration's GitHub repo is canonical for its state. Other murmurations cache and dereference; they never overwrite. Cross-murmuration state changes happen via PR (mutual coordination) or via reading the other's repo (one-way subscription).

This eliminates an entire class of consensus problems. There is no Matrix State Resolution for flyway because there is no shared state to resolve. Every object has one home repo.

---

## 4. What governance traditions teach us

The governance survey (`governance-models-survey.md` in this directory) covers Sociocracy 3.0, Holacracy, Ostrom's design principles for the commons, polycentric governance, cooperative federations (Mondragon, US food co-ops, platform cooperatives), open-source governance models (Apache, Debian, Django, Linux kernel maintainership), DAOs, and conflict-resolution frameworks (Theory U, Case Clinic, mediation/arbitration). The full document is ~5,000 words.

### 4.1 The headline finding

> **S3 is the right vocabulary, but flyway needs to extend it for the multi-Source case.**

S3's documented patterns (circles, double-linking, delegate circles, helping circles) are intra-organizational. They assume a path of escalation that bottoms out at some shared sovereign. In flyway's setup, there is no such bottom — Murmuration A's Source and Murmuration B's Source are equally sovereign. S3's literature has no canonical pattern for this case.

This is novel territory. flyway will invent some patterns. The frameworks below are the precedents.

### 4.2 The "two Sources disagree" problem

Compared across traditions:

| Tradition            | When peers disagree                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **S3**               | Drive structuring + delegate circle + consent. Bottoms out at the parent circle if irreducible. |
| **Holacracy**        | Escalate up the lead-link chain to the anchor circle. Constitution is the final arbiter.        |
| **Ostrom (commons)** | Negotiate rules; resort to graduated sanctions; ultimately accept that some commons fail.       |
| **Mondragon**        | Congress votes weighted but bounded; member coops can leave the federation.                     |
| **Apache**           | Lazy consensus; if blocked, proposal fails; project may fork.                                   |
| **Linux kernel**     | Linus or his lieutenant decides; alternative: fork.                                             |
| **DAO (Moloch)**     | Any member can rage-quit at any time, withdrawing pro-rata.                                     |

The pattern across all of them: **disagreement that cannot be resolved through dialogue ends in either fork or exit.** None of these traditions invents a mechanism that forces sovereign peers into agreement.

flyway's answer should be the same: when two Sources disagree, the framework's answer is *each murmuration retains its sovereignty, and no joint action is taken.* Honest about the limit. Refuse to design forced agreement.

### 4.3 The ten governance recommendations

Distilled from the survey:

1. **Adopt S3 as the default for inter-murmuration consent**, but make it pluggable per agreement. Two murmurations can negotiate a different decision rule (lazy consent, weighted vote, etc.) when both prefer it.
2. **Introduce a "negotiate-rules-first" handshake.** When two murmurations enter a collaboration, the first artifact they produce together is an *engagement agreement*: scope, decision rule, escalation ladder, review date, exit terms.
3. **Make "no joint action" a first-class outcome.** When consent fails, retreat to sovereignty. Don't manufacture agreement.
4. **Implement lazy consent as the default for routine inter-murmuration coordination.** State intent, wait 72 hours, silence = consent. Reserve formal consent rounds for substantive matters.
5. **Use signed PRs and signed agreements as the primitive substrate.** Cryptographic identity is already free via GitHub. The Linux kernel's signed-handoff model is the precedent.
6. **Treat goals as governed entities with explicit lifecycles.** Form (driver), commit (agreement with review date), revise (consent of both), retire (explicit closure). Without this, goals silently drift.
7. **Make "syndicate" an explicit, optional structure.** A persistent multi-murmuration relationship, registered as such, with its own governance log, its own review cadence, its own dispute mechanism. Cheap to enter, cheap to leave.
8. **Counter-balance asymmetric power explicitly.** Either by structural separation, opt-out rights (rage-quit), or weighted-but-bounded influence.
9. **Build in cheap, fast conflict resolution.** A 30-day arbitration is no arbitration. Aim for resolutions in days. Use Case Clinic-style structured dialogue as the lightest tier.
10. **Mirror the operational protocol.** GitHub as system of record, agreements as YAML, decisions as commits. Don't invent new substrate when the existing one already encodes most invariants.

---

## 5. The collaboration primitives

This is the central synthesis. What atomic operations does flyway need?

A *collaboration primitive* is the smallest action two or more murmurations take together. The primitives below compose into the higher-level patterns (project, syndicate, joint governance).

### 5.1 Discovery primitives

#### `flyway:announce`
A murmuration publishes its existence to a directory. Concretely: a PR to a `flyway-directory` repo (multiple directories may exist; murmurations choose which) adding a row referencing the murmuration's repo URL and entity statement.

#### `flyway:resolve`
Given a murmuration identifier (URL or DID), retrieve its current entity statement and verify its signature. Concretely: HTTPS GET of `<repo>/.well-known/did.json` and `<repo>/flyway/entity-statement.json`, JWT signature verification.

### 5.2 Identity primitives

#### `flyway:identity`
Each murmuration is identified by a `did:web` rooted at its repo: `did:web:github.com:owner:repo`. The DID document at `<repo>/.well-known/did.json` contains the murmuration's signing key(s) and pointers to its entity statement, governance plugin, and recognized peers.

#### `flyway:rotate-key`
A murmuration's signing key is rotated by committing a new DID document to `.well-known/did.json` with the new key, while keeping the old key as `revoked: <timestamp>` for a transition window. Peers verify against the latest DID document.

### 5.3 Recognition primitives

#### `flyway:recognize <peer>`
A unilateral act by Murmuration A: A adds B to its recognized-peers list (committed to A's repo at `flyway/peers.yaml`). This expresses willingness to engage, not yet agreement on rules.

#### `flyway:un-recognize <peer>`
Unilateral. A removes B from its peers list. Always reversible from A's side; B has no recourse, which is correct. Operator agency.

### 5.4 Engagement primitives

#### `flyway:propose-agreement <peer>`
A files a PR against B's repo (`flyway/agreements/<a-id>.yaml`) and a paired PR against its own repo (`flyway/agreements/<b-id>.yaml`) proposing the rules of engagement. Both must be merged for the agreement to take effect. Each side reviews independently per its own governance.

#### `flyway:revise-agreement <peer>`
Either side can open a revision PR. Same dual-merge pattern. Treated as a governance change subject to whichever consent rule the agreement prescribes.

#### `flyway:exit-agreement <peer>`
Either side can unilaterally exit by committing the agreement's exit clause. Closes the agreement; transition rules from the agreement (e.g., "open work-in-progress completes; no new work starts") apply.

### 5.5 Collaboration primitives (project mode)

#### `flyway:propose-project <peer> <topic>`
One side proposes a specific project: scope, deliverable, timeline, decision rule (defaults to the engagement agreement's rule). Realized as a synchronized pair of `source-directive` issues, one in each repo, with shared correlation ID.

#### `flyway:join-project <project-id>`
A third (or fourth, etc.) murmuration joins an in-flight project. Adds itself to the project's signatories list; subject to existing signatories' consent per the project's decision rule.

#### `flyway:cross-meeting <project-id>`
Convene a structured meeting with delegates from each participating murmuration. Implementation: a synchronized pair (or n-tuple) of `runGroupWake` invocations, one per murmuration, with members exchanging positions through mirrored issues. Facilitator role rotates per agreement.

#### `flyway:close-project <project-id>`
Mark the project complete. Each side commits a closure note. If consent fails (e.g., one side considers it incomplete), the project remains open; one side may withdraw via `flyway:exit-project`.

### 5.6 Collaboration primitives (syndicate mode)

#### `flyway:form-syndicate <peers...>`
N murmurations declare a longer-term relationship. Realized as a registered syndicate entry in each member's repo (`flyway/syndicates/<syndicate-id>.yaml`) plus a syndicate registry repo (`flyway-syndicates/<syndicate-id>/`). The syndicate has its own governance log, review cadence, and member roster.

#### `flyway:syndicate-meeting <syndicate-id>`
Recurring scheduled meeting of syndicate members. Same mechanism as `flyway:cross-meeting` but on a cron and persistent.

#### `flyway:syndicate-decision <syndicate-id>`
Decisions affecting all members. Subject to whichever decision rule the syndicate's bylaws specify (defaults to S3 consent).

#### `flyway:dissolve-syndicate <syndicate-id>`
End the syndicate. Either by all-member consent or by triggering the dissolution clause from the syndicate bylaws.

### 5.7 Conflict primitives

#### `flyway:tension <peer> <topic>`
Either side surfaces a tension within an agreement, project, or syndicate. Realized as an issue with `flyway-tension` label in both repos.

#### `flyway:case-clinic <tension-id>`
Convene a structured Case Clinic dialogue (per Theory U / Presencing Institute) — a 30–45 minute round between human Sources, mediated by a neutral facilitator (could be the Spirit of either murmuration, or a third party). Output: structured insight notes posted to both tensions.

#### `flyway:exit-on-tension <tension-id>`
Either side can declare the tension irreducible and exit the agreement/project/syndicate that contains it. Triggers the relevant exit clause.

### 5.8 Signal primitives

#### `flyway:share <peer> <issue>`
Murmuration A labels one of its own issues with `flyway-share:<peer>`. flyway's signal aggregator on B's side reads this and surfaces it as a `kind: "peer-action-item"` signal in B's agents' wake bundles. B's agents may act on it (creating a corresponding local issue, commenting, etc.) subject to write-scope agreements.

#### `flyway:subscribe <peer> <topic>`
Murmuration B subscribes to a topic stream from A: e.g., "all issues with label `published`," "all governance decisions," "all directive completions." Realized as a persistent watcher in B's flyway runtime.

### 5.9 Notes on primitive design

- **All primitives are GitHub-rooted.** Every artifact above is a Git commit, an issue, a label, a comment, or a PR. flyway adds no new transport.
- **All primitives are reversible at low cost** except for `flyway:rotate-key` (correctly irreversible — that's the point of rotation) and `flyway:dissolve-syndicate` (correctly heavy — disrupting persistent relationships should not be lightweight).
- **All primitives respect operator agency.** Every "do something to a peer" primitive requires the peer's consent (PR merge, mutual signature, etc.) or is purely local (un-recognize, exit, withdraw).
- **All primitives are observable.** The full state of any agreement, project, or syndicate is reconstructible by reading the relevant repos.

---

## 6. Architecture

flyway is a **runtime-agnostic protocol** with a reference TypeScript implementation and a family of client integrations. The protocol lives at the GitHub/Git/DID layer; participants choose any client that implements it.

### 6.1 The three layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3: Client integrations                                       │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ harness  │ │  Claude  │ │   MCP    │ │   CLI    │ │   chat   │  │
│  │ adapter  │ │   Code   │ │  server  │ │  (one-   │ │  client  │  │
│  │          │ │  skill   │ │ (Cursor, │ │  shot)   │ │ adapter  │  │
│  │          │ │          │ │  IDE…)   │ │          │ │(OpenClaw)│  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       └────────────┴────────────┼────────────┴────────────┘        │
│                                 │                                   │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────┐
│  Layer 2: Reference implementation                                  │
│                                                                     │
│   @murmurations-ai/flyway-core   (TypeScript library)               │
│   - Identity (DID resolution, signing, verification)                │
│   - Entity statement loading + JWT verify                           │
│   - Peer registry + agreement model                                 │
│   - Primitive RPC (open directive, mirror, etc.)                    │
│   - Schema validation against @murmurations-ai/flyway-schemas       │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────┐
│  Layer 1: Protocol                                                  │
│                                                                     │
│   - Wire format: GitHub artifacts (issues, PRs, comments, commits)  │
│     and JSON files in `flyway/` directory of each murmuration's     │
│     own repo                                                        │
│   - Identity: did:web rooted at <repo>/.well-known/did.json         │
│   - Auth: JWT signing of entity statements + actions                │
│   - Schemas: @murmurations-ai/flyway-schemas (Git-versioned)        │
│   - Discovery: thin GitHub-hosted directories + aggregators         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The protocol is the contract. Anyone implementing it is a first-class participant. The reference implementation makes it cheap to implement; the client integrations make it cheap to *use* from common tools.

### 6.2 Layer 1 — the protocol

The protocol is defined entirely by:

- **Schemas** (in `@murmurations-ai/flyway-schemas`, a versioned Git repo) for: DID documents, entity statements, peer registry entries, engagement agreements, projects, syndicates, directives, governance rounds, tensions.
- **GitHub artifact conventions** for: which issue label denotes a flyway directive, which file path holds an entity statement, which PR convention proposes an agreement, etc.
- **Cryptographic conventions:** JWT (JWS) over canonical JSON, did:web identity resolution, ed25519 default signing.
- **Lifecycle state machines** for: agreements, projects, syndicates, directives, governance rounds, tensions.

A spec doc (eventually shipped at `flyway-protocol-v1.md` in this repo) is the formal artifact. Anything that produces and consumes the right artifacts in the right shape is a flyway participant — regardless of language or runtime.

### 6.3 Layer 2 — the reference implementation

`@murmurations-ai/flyway-core` is a pure TypeScript library implementing the protocol. It has no runtime assumptions — it can be used from a Node daemon (the harness), from a Claude Code skill, from an Electron app, from a CLI, or from a plain browser. It depends only on:

- A JavaScript fetch implementation (universal)
- A signing implementation (Web Crypto API in browser; node:crypto in Node; configurable)
- A GitHub API client (could be the harness's `@murmurations-ai/github`, or `@octokit/rest`, or raw fetch)

The library exposes high-level operations (e.g., `proposeDirective(peer, body)`, `acceptAgreement(peerId, agreementId)`, `resolvePeer(did)`) and low-level primitives (e.g., `signJWT(payload)`, `verifyEntityStatement(json)`, `mirrorIssue(srcRepo, dstRepo, issueId)`).

### 6.4 Layer 3 — client integrations

Five client integrations are recommended for v0.1, in approximate priority:

| Integration | Package | What it gives | Who it serves |
|---|---|---|---|
| **Harness adapter** | `@murmurations-ai/flyway-harness` | `FederationCollaborationProvider` + governance plugin + Spirit skills | Sources running the murmurations-harness |
| **Claude Code skill** | `@murmurations-ai/flyway-claude-code` | A Claude Code skill exposing flyway operations as agent tools | Sources working in Claude Code sessions (interactive or ephemeral) |
| **MCP server** | `@murmurations-ai/flyway-mcp` | Generic MCP server exposing flyway operations as MCP tools | Sources using any MCP-capable client (Cursor, Continue, etc.) |
| **CLI** | `@murmurations-ai/flyway-cli` | Terminal one-shots (`flyway propose <peer> <body>`, `flyway agreements list`, etc.) | Sources who want manual / scripted control without a daemon |
| **Chat client adapter** | `@murmurations-ai/flyway-chat` | Patterns for a chat-bound agent (OpenClaw via Discord/Telegram) to participate | Sources running OpenClaw or similar chat-based agent systems |

A sixth option that needs no package: **manual GitHub use.** A Source with no tooling beyond a web browser can read peer entity statements, comment on flyway directives, and merge agreement PRs. The protocol is human-usable as a baseline; the integrations make it ergonomic.

### 6.5 Participation modes

Any single Source's relationship to flyway falls into one of four modes. A given collaboration may include participants in different modes simultaneously.

| Mode | Description | Latency to respond | Example |
|---|---|---|---|
| **Persistent** | Continuous daemon, scheduled wakes, programmatic triggers | seconds–minutes | Murmurations-harness installation |
| **Interactive** | Source actively at their tool when in flight | seconds when Source is present, hours when not | Source working in Claude Code, Cursor, or chat client |
| **Asynchronous** | GitHub-only; no real-time presence | hours–days | Source reading email-style notifications and replying via web UI |
| **Ephemeral** | One-shot — Source spins up, joins, does some work, exits | per-session | Source opens Claude Code for ~30 minutes to participate in a single round |

**Constraints across modes:**

- All modes use the same protocol primitives (issues, PRs, comments, signed artifacts in `flyway/`).
- All modes preserve operator agency — a Source can refuse, exit, or rotate at any time.
- All modes require the same identity: `did:web` rooted at a stable repo. The Source's *runtime* may be ephemeral; the Source's *identity* is persistent.

**Where modes affect protocol:**

- **Goal lifecycle timeouts.** A project that needs decisions in minutes is incompatible with a participant in async-only mode. Engagement agreements should specify expected response cadence, and participants should self-declare their mode (or default mode) in their entity statement.
- **Hosting governance rounds.** A consent round or syndicate meeting needs *some* persistent or scheduled-interactive participant to act as facilitator. Pure-ephemeral collaborations can run lazy-consent agreements but probably can't host long S3 rounds.
- **Real-time signal delivery.** If a participant is async-only, they may take days to see a directive. If their agreement requires faster response, they should upgrade their mode (or consent fails on time-bound matters).

The protocol does not ban any mode. It just makes the cadence consequences visible.

### 6.6 The minimum viable client

A flyway client of any kind must be able to:

1. **Read** GitHub artifacts of any peer murmuration's repo (clone or API)
2. **Verify** peer signatures via `did:web` resolution + JWT signature validation
3. **Sign** its own outgoing artifacts using a key whose public half is in the Source's DID document
4. **Write** its own murmuration's repo (issues, PRs, comments, file commits) using whichever GitHub access the Source has configured

A bash script with `curl`, `jq`, and `ssh-agent` can in principle implement all four. Most participants will use a higher-level client. The point is the bar is *low*: flyway is not gated on running specific software.

### 6.7 Operator repo additions

A flyway-participating Source's repo gains the following structure (regardless of runtime — the harness, a Claude Code session backed by a personal repo, a manual operator's notes repo, etc. all use the same shape):

```
<source-repo>/
├── .well-known/
│   └── did.json                              # DID document (did:web)
├── flyway/
│   ├── entity-statement.json                 # signed entity metadata
│   │                                         #   - identity, public key, mode (persistent/...)
│   │                                         #   - declared client integrations
│   │                                         #   - schemas spoken
│   │                                         #   - recognized peers
│   ├── peers.yaml                            # recognized peers (mode-aware)
│   ├── agreements/
│   │   └── <peer-id>.yaml                    # per-peer engagement agreements
│   ├── projects/
│   │   └── <project-id>.yaml                 # project metadata (mirror in peer repos)
│   ├── syndicates/
│   │   └── <syndicate-id>.yaml               # syndicate membership
│   └── cache/                                # gitignored peer-state cache
└── (any other Source-specific files —
   harness.yaml, role.md, .claude/, etc.
   are runtime-specific and not flyway concerns)
```

A harness installation has the rich `agents/`, `governance/`, `runs/` directory tree alongside `flyway/`. A Claude Code session might have only `.claude/` and `flyway/` — and that's fine. flyway only cares about `flyway/` and `.well-known/did.json`.

### 6.8 Three required harness ADRs (small, additive — for the harness adapter only)

For the *harness adapter* to compose cleanly with the harness's existing primitives, the harness needs:

1. **Plugin composition for governance.** Allow `governance.plugins[]` (ordered) or a wrapping pattern so flyway's federation plugin can complement a murmuration's existing S3 plugin rather than replace it.
2. **CollaborationProvider repo dimension.** Either add `repo` parameter to provider operations or formalize the "wrap multiple per-repo providers" pattern. Probably the latter (no breaking change).
3. **Signal kind registration + action handler registration.** Document how new signal kinds and wake action kinds get registered so flyway's contributions are first-class rather than ignored-with-warning.

None of the three are blocking — flyway v0.1 can land before any of them — and they only affect the harness adapter, not the protocol or other client integrations. Sources using Claude Code or the CLI or MCP can collaborate with harness-using Sources today without these ADRs landing, because the cross-runtime work happens at the protocol layer (GitHub artifacts), not inside any one runtime.

### 6.9 The MVP — revised for cross-runtime

One primitive, end-to-end, between two participants on **different runtimes**. Specifically: **mirrored cross-murmuration directives between one harness installation and one Claude Code session.**

This is a deliberate change from the original "two harness installations" MVP. Demonstrating the protocol working across runtimes is more important than demonstrating it within one runtime — because the runtime-agnostic property is what makes flyway useful.

Demo path:

1. Source-A runs the murmurations-harness on `xeeban/emergent-praxis`. The harness adapter is installed; flyway's `FederationCollaborationProvider` is wired into `harness.yaml`.
2. Source-B doesn't run the harness. Source-B has a personal repo (e.g., `bob/source-repo`) with `flyway/entity-statement.json` declaring identity. Source-B participates by opening Claude Code in a directory with the flyway Claude Code skill installed.
3. Both Sources have committed mutual recognition (`flyway/peers.yaml` updated on both sides) and a signed engagement agreement (`flyway/agreements/<peer>.yaml` merged into both repos via PR).
4. **Test 1 (harness → Claude Code):** Source-A's Spirit runs `:flyway propose source-b "review this draft"`. The harness adapter opens an issue in A's repo (`source-directive` + `flyway-directive` labels) and mirrors it into B's repo. Source-B opens Claude Code, the skill detects new flyway directives in B's signal context, surfaces the issue. Source-B's session asks Claude (with the flyway skill) to draft a response. Skill posts the response to B's issue. Adapter mirrors the response back to A. A's agents see the response in A's signal bundle on next wake.
5. **Test 2 (Claude Code → harness):** Reverse direction. Source-B uses the flyway skill in a Claude Code session to propose a directive at A. The skill writes the directive to B's repo and to A's repo (via the agreement-permitted scopes). A's harness sees it in the next signal aggregation cycle and routes to assigned agents. Agents respond; harness adapter mirrors to B.

If that bidirectional loop works between *one harness and one Claude Code session*, flyway has demonstrated:

- The protocol works across runtimes
- Identity verification across runtimes
- Engagement agreements as the trust substrate
- Mirrored artifacts as the canonical primitive
- An ephemeral participant (Claude Code) collaborating with a persistent participant (harness)

Everything else — projects, syndicates, conflict resolution, schema-evolution, additional client integrations — is layered on top.

A more ambitious v1.5 demo: **three-party collaboration** — one harness, one Claude Code, one CLI/manual GitHub — running a single project end-to-end. This proves the heterogeneous case explicitly.

---

## 7. Pluggable governance — answering the user's specific question

The user asked: should the inter-murmuration governance protocol be pluggable, allowing different murmurations to agree on their governance protocols between themselves?

**Answer: yes, at the agreement layer, with S3 as the default.**

### 7.1 The mechanism

Each *engagement agreement* between two murmurations specifies a `decision_rule` field in its YAML. Default is `s3-consent` (Sociocracy 3.0 consent). Alternatives that flyway should support out-of-the-box:

| `decision_rule` | Semantics | Use case |
|---|---|---|
| `s3-consent` (default) | Each side's facilitator runs an S3 consent round on its delegate; both must complete without qualified objection | Substantive decisions; novel territory |
| `lazy-consent` | Proposal stated, 72-hour quiet window, silence = consent | Routine matters; well-understood patterns |
| `dual-source-sign` | Each Source must sign the proposal directly (PR review with signed commit) | High-stakes, irrevocable decisions |
| `weighted-vote-bounded` | Members get votes weighted by an agreed criterion (e.g., contribution, stake), but no member exceeds 40% | Asymmetric-but-bounded scenarios |
| `apache-vote` | Three +1 votes pass, any -1 with reasoning blocks | Open-source-style decisions in software collaborations |

The list is not exhaustive — the point is that the agreement says which rule applies. Murmurations that prefer different rules don't have to adopt each other's preferences; they negotiate per-pair.

### 7.2 The governance plugin shape

`@murmurations-ai/flyway-governance-plugin` ships with an `s3-consent` implementation plus the five rules above. Each rule is a class implementing a `FederationDecisionRule` interface:

```ts
interface FederationDecisionRule {
  readonly id: string;                                    // "s3-consent", "lazy-consent", etc.
  readonly displayName: string;
  proposeRound(proposal: FederationProposal): Promise<RoundId>;
  collectPosition(roundId: RoundId, party: PartyId, position: Position): Promise<void>;
  evaluate(roundId: RoundId): Promise<Outcome>;           // pending | passed | blocked | exited
  describe(roundId: RoundId): Promise<RoundState>;        // human-readable status
}
```

Custom rules ship as additional packages (`@murmurations-ai/flyway-rule-borda`, `@your-org/flyway-rule-quadratic`, etc.). Murmurations whose agreement uses a custom rule both install the rule package; if either is missing it, the round can't run.

### 7.3 Why not protocol-uniform?

Three reasons:

1. **Different work has different costs of being wrong.** A typo correction in a shared draft article does not warrant the same process as a decision to dissolve a syndicate. The rule should match the stakes.
2. **Different murmurations have different cultures.** A murmuration whose internal governance is hierarchical may not want to adopt full S3 just to cooperate with another. Pluggability lets them participate without changing internally.
3. **The protocol is already pluggable in the harness.** The GovernancePlugin interface is model-agnostic by design (per `CLAUDE.md`'s "core must not contain S3-specific terms"). flyway carries that pluggability up the stack.

### 7.4 What's *not* pluggable

These are flyway invariants regardless of decision rule:

- **Operator agency.** No rule can force a Source to accept an action they reject.
- **Cryptographic identity.** Every action is signed by some party.
- **Append-only history.** Decisions, once made, are recorded immutably and replayable.
- **Exit rights.** Every party can exit any agreement at any time, subject only to the agreement's transition clause.

These are the substrate. The decision rule rides on top.

---

## 8. Goals and projects — answering the user's specific question

The user asked: when collaboration happens, there's probably a goal — should we look at that?

**Answer: yes. Goals are governed entities with explicit lifecycles. flyway treats them as first-class objects.**

### 8.1 The goal lifecycle

Borrowed from S3's "driver → proposal → agreement" pattern, extended for cross-murmuration scope:

```
   ┌─────────────┐       ┌──────────┐       ┌──────────┐       ┌─────────┐
   │  proposed   │──────▶│ agreed   │──────▶│ in-flight│──────▶│ closed  │
   └─────────────┘       └──────────┘       └──────────┘       └─────────┘
        │                     │                    │                 │
        │                     │                    │                 │
        ▼                     ▼                    ▼                 ▼
    rejected              revised              suspended         retrospected
                                                  │
                                                  ▼
                                              resumed | abandoned
```

Each transition is a governance act subject to the agreement's `decision_rule`.

### 8.2 The goal artifact

A goal lives in `flyway/projects/<project-id>.yaml` (or `flyway/syndicates/<syndicate-id>/goals/<goal-id>.yaml` for syndicate-scoped goals):

```yaml
id: review-article-draft-001
participants:
  - did:web:github.com:xeeban:emergent-praxis
  - did:web:github.com:other-org:other-murmuration
state: in-flight
agreement: <agreement-id>
decision_rule: s3-consent
deliverable: "Reviewed article draft, both murmurations consent to publish or block"
deadline: 2026-05-15
review_cadence: weekly
exit_clause: "Either side may withdraw; remaining participants may continue"
governance_log: "issues with label flyway-project:review-article-draft-001 in both repos"
```

Both participants commit identical copies (or a canonical copy with a cryptographic reference in each peer's repo, with audit-replay reconstruction).

### 8.3 Why explicit lifecycle matters

The most common failure mode in cross-organizational work — observed across cooperative federations, open-source consortia, and academic collaborations — is *silent goal drift*. A project starts with one understanding of "done," everyone gets busy, scope expands or contracts informally, and at some point one party decides it's done while the other thinks it's still in progress. The relationship sours.

Explicit lifecycle prevents this. Every state transition is a governance act with a recorded rationale. "We agree this project is closed" is a *decision*, not an interpretation. If any participant disagrees, the project remains open and the disagreement is a tension.

### 8.4 Goals vs syndicates

A *project* has a defined deliverable and an end. A *syndicate* is open-ended.

Both have goals. A project's goal is its deliverable. A syndicate's goals are renewed (or replaced) at each review cadence.

Murmurations can do project work without forming a syndicate (most collaboration probably looks like this). Syndicate formation is a deliberate step up: "we expect to do this kind of work together repeatedly, and want to invest in shared infrastructure."

---

## 9. Long-term collaboration — answering the user's specific question

The user asked: are there longer-term ongoing collaborations beyond projects, at a syndicated organizational level?

**Answer: yes. flyway names these *syndicates* and treats them as first-class but optional.**

### 9.1 What a syndicate is

A registered, persistent multi-murmuration relationship with:

- A shared name and identity
- A roster of member murmurations
- Governance bylaws (decision rule, member admission rule, member expulsion rule, dissolution clause)
- A regular review cadence (typically quarterly)
- Its own governance log (separate from any individual member's log)
- Optionally: shared schemas, shared tools, shared agents, shared funds (out of scope for flyway v0.1; mentioned for completeness)

### 9.2 What a syndicate is *not*

- Not a legal entity. Syndicates have no standing in any jurisdiction. (Member murmurations may be legal entities or not; that's their concern.)
- Not a super-organization with authority over its members. Members retain full sovereignty.
- Not a permanent commitment. Any member can exit per the bylaws' exit clause; the syndicate dissolves per the dissolution clause.
- Not a requirement. Most flyway use cases will be project-scoped, not syndicate-scoped. Syndicates exist for the cases where the relationship outlives any single project.

### 9.3 Precedents

- **Mondragon Cooperative Corporation.** Federation of worker coops. Members retain operational autonomy; congress of delegates makes federation-level decisions.
- **Apache Software Foundation.** Federation of open-source projects (PMCs). Each PMC governs itself; ASF governs across-project matters.
- **Linux Foundation TSCs (Technical Steering Committees).** Multi-organization technical governance for shared codebases.
- **Platform cooperatives (Stocksy, Up & Go).** Multi-stakeholder governance with explicit asymmetric-power protections.

All four have explicit governance bylaws + persistent identity + member roster + review cadence + dissolution clause. flyway's syndicates are a thin software-native version of the same pattern.

### 9.4 When to form a syndicate

Indicator | Suggests |
|---|---|
| Repeated project-scope work between the same murmurations | Syndicate worth considering |
| Need for shared schemas or shared agents | Syndicate is the right home |
| Regular cadenced touchpoints already happening informally | Syndicate formalizes what's there |
| Single one-off project | Stay with project mode; don't form a syndicate |
| Disagreement on whether to form one | Don't form one yet; do more project work first |

The principle: **syndicates should ratify existing relationships, not create them.** Forming a syndicate before the underlying relationship exists is a common failure mode (cooperatives, consortia, treaty bodies). flyway's defaults should make this hard to do accidentally.

---

## 10. The "two Sources disagree" case — concretely

This deserves its own section because the user asked about it explicitly.

### 10.1 The setup

Murmuration A's Source and Murmuration B's Source come into substantive conflict. Either over a project's deliverable, a syndicate's direction, or a structural disagreement that cuts across multiple collaborations.

### 10.2 The escalation ladder

flyway prescribes (in agreement defaults; pluggable per agreement):

1. **Direct dialogue, async via comments.** Quick, cheap. Most disagreements resolve here — either by clarification of misunderstanding or by one side updating their position based on the other's argument.
2. **Tension formally surfaced** (`flyway:tension`). The disagreement becomes a tracked artifact with a label, a body, and a resolution timeline.
3. **Case Clinic dialogue** (`flyway:case-clinic`). Real-time structured conversation between the human Sources, mediated by a facilitator. Theory U's Case Clinic protocol gives a 30–45 minute structure: presenting case → clarifying questions → mirroring → generative dialogue → closing reflection. Agents may attend as observers or note-takers; only Sources speak in the substantive rounds.
4. **Mediation by an agreed neutral.** If Case Clinic doesn't resolve, both sides agree on a mutually-acceptable third party (often another murmuration's Source, or a designated mediator named in the agreement). Mediator does not decide; they help structure dialogue.
5. **Adjudication, only if the agreement explicitly provides for it.** Some agreements may grant a designated body decision authority on specific disputes. Most agreements should not. flyway does not assume adjudication; it's an explicit per-agreement clause.
6. **Exit.** Either side declares the tension irreducible (`flyway:exit-on-tension`) and walks away from the agreement, project, or syndicate that contains it. Transition rules apply (e.g., open work-in-progress completes; no new joint commitments).

### 10.3 Time targets

A useful discipline borrowed from ADR practice:

- Steps 1–2 (direct + tension): same day or next day
- Step 3 (Case Clinic): within one week
- Step 4 (mediation): within two weeks
- Step 5 (adjudication, if applicable): per the agreement's clause; aim for one month max
- Step 6 (exit): immediate after declaration

A 60-day arbitration is no arbitration. Cheap, fast escalation is the friend; long, formal processes are the enemy. Most organizational governance traditions have learned this the hard way.

### 10.4 What flyway does *not* do

- It does not manufacture agreement. If both Sources hold their position after all five steps, the answer is exit.
- It does not retain authority over either Source. Neither Source is bound by anything they didn't sign.
- It does not punish exit. Exit is the proper outcome when consent fails.

This is the single most important principle in flyway's design. The frameworks that try to force agreement (some DAOs, some traditional treaty bodies) tend to either ossify into bureaucracy or fracture into camps. The frameworks that let parties walk away cleanly tend to outlast the ones that don't.

---

## 11. Recommendations

### 11.1 Architectural — runtime-agnostic

1. **Build flyway as a three-layer stack** (protocol / reference impl / client integrations — per §6.1), not as a single integration with any one runtime. The protocol is the contract; runtimes are pluggable.
2. **The reference implementation is `@murmurations-ai/flyway-core`** — pure TypeScript, no runtime assumptions, usable from Node, browsers, Electron, or any JS-capable environment.
3. **Ship five client integrations for v0.1** (per §6.4): harness adapter, Claude Code skill, MCP server (for Cursor and other MCP clients), CLI, and a chat-client adapter pattern. Document a sixth: manual GitHub use as the always-available baseline.
4. **File 3 small additive harness ADRs** (per §6.8) for plugin composition, CollaborationProvider repo dimension, and signal/action kind registration. These affect only the harness adapter — not the protocol or other clients. None blocking.
5. **MVP is mirrored cross-murmuration directives between one harness and one Claude Code session** (per §6.9). Demonstrating cross-runtime is more important than cross-installation.

### 11.2 Identity & discovery

6. **Adopt `did:web` identity** rooted at each Source's repo (`<repo>/.well-known/did.json`). Identity is anchored at the Source level, not at any runtime. A Source can change runtimes without changing identity.
7. **Adopt OpenID Federation-style entity statements** in `<repo>/flyway/entity-statement.json`, signed JSON listing DID, public key, declared mode (persistent/interactive/async/ephemeral), declared client integrations, governance plugin, recognized peers, schemas spoken.
8. **Adopt thin GitHub-hosted directories + opinionated aggregators** for discovery, borrowing from Murmurations.network's pattern. Directories list participants regardless of runtime.

### 11.3 Recognition & engagement

9. **Per-pair engagement agreements** as the load-bearing primitive. Negotiated as PRs against both repos; review per each side's governance; exit clauses required. Agreements may specify expected response cadence so cross-mode pairings (e.g., persistent + ephemeral) are explicit about timing.
10. **Lazy consent as the default for routine matters** (72-hour quiet window). Reserve formal consent rounds for substantive decisions.
11. **No joint action when consent fails.** Codify this; refuse to design forced-agreement mechanisms.

### 11.4 Governance

12. **S3 consent as the default decision rule.** Pluggable per agreement; ship five rules out-of-the-box (s3-consent, lazy-consent, dual-source-sign, weighted-vote-bounded, apache-vote).
13. **Goals as governed entities** with explicit lifecycles (proposed → agreed → in-flight → closed | retrospected). State transitions are governance acts.
14. **Syndicates as optional persistent structures** distinct from project-scoped collaboration. Syndicates ratify existing relationships rather than creating them. Note: a syndicate that requires real-time coordination implicitly requires at least one persistent participant; agreements should make this explicit.

### 11.5 Conflict resolution

15. **Six-step escalation ladder** (direct → tension → Case Clinic → mediation → adjudication-if-clause → exit). Time-bounded. Cheap to enter, fast to escalate, clean to exit.
16. **Case Clinic as the lightweight structured-dialogue tier**. Borrowed from Theory U; appropriate for inter-Source disputes. Sources participate as humans regardless of runtime — the dialogue happens in real-time even if their day-to-day work is asynchronous.

### 11.6 Schemas & evolution

17. **Schemas live in a shared `flyway-schemas` repo**. Versioned. New schemas land via PR. Participants declare which schema versions they speak in their entity statement.

### 11.7 Operator experience — per runtime

18. **Harness adapter:** Spirit skills (`:flyway peers`, `:flyway propose`, `:flyway agreements`, etc.) ship in `@murmurations-ai/flyway-harness`.
19. **Claude Code skill:** ship `@murmurations-ai/flyway-claude-code` as a standalone skill that adds flyway tools to any Claude Code session. The skill provides the same operations as the Spirit skills, exposed as agent tools rather than slash commands.
20. **MCP server:** ship `@murmurations-ai/flyway-mcp` as a standalone MCP server. Cursor users add it to their MCP config; Continue users do the same; any MCP-capable client gets flyway tools without separate work.
21. **CLI:** ship `@murmurations-ai/flyway-cli` for terminal one-shots. Useful for Sources who want manual control, scripted automation, or integration into their existing tooling.
22. **Chat-client adapter pattern:** publish a documented pattern (probably as an example in the flyway repo) for an OpenClaw-or-similar chat-bound agent to participate. The pattern uses the same `@murmurations-ai/flyway-core` library; the integration work is wiring it into the chat client's command surface.

---

## 12. Open questions and follow-on research

This paper addresses what research can answer. The following five questions require design choices, not research:

1. **Identity rotation strategy.** How does a murmuration rotate its signing key without disrupting in-flight agreements? AT Protocol has a clean answer (DID document update with revocation timestamp); flyway should adopt similar but the specifics need an ADR.

2. **Schema evolution strategy.** When `flyway-schemas` releases a new version of an agreement schema, how do existing agreements migrate? Murmurations.network's per-profile `linked_schemas` array is a model; specifics need an ADR.

3. **Threat model when a Source is captured.** If Source-A is compromised, agents will sign actions A's peers will accept. How do peers detect and respond? Holochain's automatic warrant model assumes peers can verify; flyway has only social verification (other Sources notice and revoke). This is a governance-and-security question with no easy answer. Defer to a dedicated ADR after MVP.

4. **Cost attribution.** Cross-murmuration work has cost (LLM, GitHub API). Whose budget pays? Possible answers: each side pays for its own agents; a syndicate has shared budget; a project has explicit cost-sharing terms. Probably the right answer is "the agreement specifies." Needs an ADR.

5. **Off-GitHub transport.** Does flyway need a non-GitHub channel for short-lived signals (e.g., "convening cross-meeting in 5 minutes")? GitHub issues feel heavy for ephemeral messages. DIDComm or a shared Matrix room are alternatives. Defer; GitHub-first is sufficient for v1.

These five become candidate ADRs as flyway matures. None block the v0.1 MVP.

---

## 13. What flyway is not

A discipline borrowed from the framing ADR (ADR-0001):

- flyway is **not** a controller, orchestrator, or master node above murmurations
- flyway is **not** harness-specific — the harness is one of several first-class client integrations
- flyway is **not** a hard dependency of the harness, Claude Code, Cursor, OpenClaw, or any other tool
- flyway is **not** a runtime — there is no "flyway daemon" required for participation
- flyway is **not** a federation that requires central registration
- flyway is **not** a framework that tries to manufacture agreement when Sources disagree
- flyway is **not** a substitute for any individual murmuration's own governance
- flyway is **not** novel infrastructure — it's a thin protocol on existing primitives (Git, GitHub, DIDs, JWT)

The single most-important constraint: flyway should remain *small*. Every primitive that can be pushed up to the operator (a custom agreement clause, a shared schema choice, an aggregator implementation, a runtime-specific UX detail) is a primitive flyway does not need to ship.

---

## 14. Summary in one paragraph

flyway is a runtime-agnostic protocol that treats each Source-controlled agent swarm — running on the murmurations-harness, Claude Code, Cursor, OpenClaw, manual GitHub, or anything else — as a Git repo with a stable `did:web` identity. Sources recognize one another via signed entity statements borrowed from OpenID Federation; collaborate via per-pair engagement agreements with pluggable decision rules (S3 consent default, lazy consent, dual-source sign, weighted-bounded vote, Apache-style vote); compose cross-murmuration work as either ephemeral projects or persistent syndicates with explicit goal lifecycles; and resolve conflicts via a six-step escalation ladder ending in clean exit when consent cannot be reached. Architecturally it ships as a three-layer stack: a protocol spec, a reference TypeScript core (`@murmurations-ai/flyway-core`) usable from any JS environment, and a family of client integrations for the harness, Claude Code, generic MCP clients, terminal CLI, and chat-bound agents — none of which is privileged. The MVP is mirrored cross-murmuration directives between one harness installation and one Claude Code session, demonstrating the cross-runtime story end-to-end. Everything else layers on top. The single load-bearing invariant, derived from across every protocol and governance tradition surveyed, is operator agency: every Source retains unilateral authority over what their murmuration accepts, what it forwards, whom it recognizes, and when it exits — regardless of what runtime they are using. Anything that violates that has stopped being federation.

---

## 15. Supporting documents

This paper is the synthesis of three parallel research strands, each preserved in this directory:

- `federation-protocols-survey.md` — comparative survey of ActivityPub, AT Protocol, Matrix, IPFS, Solid, OpenID Federation, Nostr, DIDComm, Holochain, Murmurations.network, Web of Trust patterns, and Git federation. ~6,800 words.
- `governance-models-survey.md` — literature review of S3, Holacracy, Ostrom, cooperative federations, open-source governance, DAOs, and conflict-resolution frameworks. ~5,000 words.
- `harness-primitives-audit.md` — inventory of existing murmurations-harness primitives and identification of extension seams for flyway. ~3,500 words.

Each was authored by a research agent (federation, governance) or by direct codebase audit (harness primitives). The agents had self-contained briefs and did not see this synthesis paper. Their findings were independent inputs; this paper's recommendations are the integration.

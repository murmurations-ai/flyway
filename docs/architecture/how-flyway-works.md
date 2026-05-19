---
date: 2026-05-19
protocol-version: 0.1.0
code-sha: eec423c
status: living document — updated as the system evolves
---

# How flyway works

A concrete walk-through of the system: components, sequence diagrams,
state machines, data flow, and contracts. Versioned against the code SHA
above; future revisions update this document and bump the SHA.

> **Reading order.** §1 gives the mental model in one page. §2 shows the
> packages and where artifacts live. §3 walks through what actually works
> today (flyway_init, skill install) with real sequence diagrams. §4
> shows the conceptual flow for cross-murmuration consent (the protocol
> surface; tool execution for it is not yet implemented). §5 covers state
> machines for the load-bearing entities. §6 lists the contracts.

---

## 1. Mental model

flyway is a **protocol for cross-murmuration collaboration**. Three layers:

1. **The substance** — Sociocracy 3.0 patterns (consent vocabulary,
   objection-vs-concern, driver/requirement/proposal stages, agreement
   structure) bundled as canonical reference and reflected in the
   typed protocol surface.
2. **The surface** — 9 typed tools (`flyway_init` … `flyway_exit`) plus
   one schema (`FLYWAY_AGREEMENT_SCHEMA`). These are the contract
   between agents and the protocol.
3. **The transport** — GitHub. Each Source's repository is the
   system-of-record for its identity, its peers, and the agreements
   it has signed. There is no central server; peers see each other
   only through committed files in each other's repos.

The agent does not "talk to flyway." The agent **loads a skill** that
teaches it the protocol's vocabulary and operations, and then it reads
and writes specific files in its Source's repo. flyway is *the
convention by which those files mean what they mean.*

---

## 2. Components

The TypeScript monorepo and the on-disk artifacts a flyway-participating
Source produces:

```mermaid
flowchart TB
  subgraph mono["flyway packages (this repo)"]
    direction TB
    CORE["<b>flyway-core</b><br/>types, schemas, pure logic<br/>(tools, instructions, agreement schema, flywayInit)"]
    AGENT["<b>flyway-agent</b><br/>SKILL.md generator<br/>(FLYWAY_SKILL_MD)"]
    CLI["<b>flyway-cli</b><br/>flyway init<br/>flyway skill install/list/uninstall"]
    MCP["<b>flyway-mcp</b><br/>stdio MCP server<br/>(tools/list, tools/call)"]
    HARN["<b>flyway-harness</b><br/>stub"]

    CORE --> AGENT
    CORE --> CLI
    CORE --> MCP
    AGENT --> CLI
  end

  subgraph repo["A Source's repository"]
    direction TB
    DID[".well-known/did.json<br/>(DID document)"]
    ES["flyway/entity-statement.json<br/>(Source metadata)"]
    KEYS["flyway/keys/source.key<br/>(private key — gitignored)"]
    PEERS["flyway/peers.yaml<br/>(recognized peers)"]
    AGREE["flyway/agreements/&lt;id&gt;.yaml<br/>(signed agreements)"]
    TENS["flyway/tensions/&lt;id&gt;.json<br/>(open tensions)"]
    SKILL[".claude/skills/flyway/SKILL.md<br/>(installed skill)"]
  end

  subgraph runtimes["Agent runtimes (Agent Skills IO–compatible)"]
    CC["Claude Code"]
    CURSOR["Cursor"]
    GEM["Gemini CLI / Codex / Goose / 30+ others"]
  end

  CLI -- "flyway init" --> DID
  CLI -- "flyway init" --> ES
  CLI -- "flyway init" --> KEYS
  CLI -- "flyway skill install" --> SKILL

  SKILL -. "loaded by" .-> CC
  SKILL -. "loaded by" .-> CURSOR
  SKILL -. "loaded by" .-> GEM

  MCP -. "exposes tools to" .-> CC
  MCP -. "exposes tools to" .-> CURSOR
```

Key invariant: **every flyway operation either reads or writes a file
under `.well-known/` or `flyway/`.** Nothing leaves the Source's
authority except by becoming a committed artifact under that authority.

---

## 3. What works today

### 3.1 Skill installation (ADR-0006)

The Source installs the flyway skill into their agent environment. The
canonical `SKILL.md` (Agent Skills IO format) is exported by
`flyway-agent` and written to a known location by `flyway-cli`.

```mermaid
sequenceDiagram
  actor S as Source (human)
  participant CLI as flyway-cli (bin/flyway.ts)
  participant REG as SKILL_REGISTRY (cli/skill.ts)
  participant AGENT as flyway-agent (FLYWAY_SKILL_MD)
  participant FS as Filesystem

  S->>CLI: flyway skill install flyway
  CLI->>CLI: inferTarget(cwd)
  Note right of CLI: .claude/ exists?<br/>→ .claude/skills/<br/>else → ./skills/
  CLI->>REG: lookup 'flyway'
  REG->>AGENT: import FLYWAY_SKILL_MD
  AGENT-->>REG: SKILL.md content (string)
  CLI->>FS: mkdir &lt;target&gt;/flyway/
  CLI->>FS: write &lt;target&gt;/flyway/SKILL.md
  CLI-->>S: Installed flyway → &lt;target&gt;/flyway
```

After this, opening the cwd in Claude Code (or any other Agent Skills IO
client) loads the flyway skill: the agent now knows the protocol
vocabulary, the tool surface, and the consent invariants.

### 3.2 Identity issuance (`flyway_init`) — via CLI

The Source creates their flyway identity. This is a one-time operation
per Source.

```mermaid
sequenceDiagram
  actor S as Source
  participant CLI as flyway-cli (bin)
  participant INIT as flyway-cli/init.ts
  participant CORE as flyway-core/init.ts
  participant CRYPTO as Node crypto
  participant FS as Source's repo

  S->>CLI: flyway init --repo-url URL --source-name NAME --mode MODE
  CLI->>INIT: runInit({repoUrl, sourceName, mode, cwd})
  INIT->>INIT: check no existing identity (else require --force)
  INIT->>CORE: flywayInit({repoUrl, sourceName, mode})
  CORE->>CORE: parseRepoUrl → ParsedRepoUrl
  CORE->>CORE: deriveDid → "did:web:github.com:org:repo"
  CORE->>CRYPTO: generateKeyPairSync('ed25519')
  CRYPTO-->>CORE: {publicKey, privateKey}
  CORE->>CORE: buildDidDocument (W3C DID + JsonWebKey2020)
  CORE->>CORE: buildEntityStatement (Source metadata)
  CORE-->>INIT: FlywayInitArtifacts
  INIT->>FS: write .well-known/did.json
  INIT->>FS: write flyway/entity-statement.json
  INIT->>FS: write flyway/keys/source.key (mode 0o600)
  INIT->>FS: ensure .gitignore excludes flyway/keys/
  INIT-->>CLI: result
  CLI-->>S: "Initialized flyway identity: did:web:..."
```

After this, the Source has a cryptographic identity (did:web) and can be
discovered, recognized, and engaged with by peers.

### 3.3 Identity issuance — via MCP

The same operation, but invoked by an agent through the MCP server. The
MCP server is **stateless** — it returns the artifacts to the agent
rather than writing them. The agent decides how to persist them (often
by then running the CLI or writing the files itself).

```mermaid
sequenceDiagram
  participant A as Agent (LLM with flyway skill loaded)
  participant MCP as flyway-mcp (stdio JSON-RPC)
  participant H as handlers.ts (callFlywayTool)
  participant CORE as flyway-core/init.ts
  participant S as Source (human)

  Note over A: SKILL.md instructions tell agent<br/>how to use flyway_init
  A->>MCP: tools/call flyway_init {repoUrl, sourceName, mode}
  MCP->>H: dispatch by name
  H->>H: validate arguments
  H->>CORE: flywayInit(input)
  CORE-->>H: FlywayInitArtifacts
  H-->>MCP: {did, didDocument, entityStatement, keypair, note}
  MCP-->>A: CallToolResult (JSON)
  A->>S: surface artifacts; ask for confirmation before persisting
  Note over A,S: Agent does not write files autonomously.<br/>Source sovereignty invariant.
```

Why stateless? Because Source sovereignty says only the Source decides
what gets written under their authority. The MCP server is a *generator*
of artifacts; the act of persisting them is a Source-authorized step.

---

## 4. Cross-murmuration consent (conceptual — surface defined, execution
pending)

The largest reason flyway exists. Two or more recognized peer
murmurations negotiate an agreement through a structured consent cycle.
Tool surface is defined today; actual GitHub I/O lands in future tool
implementations.

```mermaid
sequenceDiagram
  participant A as Murmuration A (agent)
  participant ARepo as A's GitHub repo
  participant BRepo as B's GitHub repo
  participant B as Murmuration B (agent)

  Note over A,B: Phase 1 — Tension surfaced (S3 §IV.1.2 Navigate via Tension)
  A->>ARepo: flyway_tension {peerDid: B, conditions, effect, relevance}
  Note over ARepo,BRepo: Mirrored as a GitHub issue<br/>under flyway/tensions/T-001
  B->>BRepo: flyway_check (reads incoming signals)
  B->>BRepo: flyway_respond {subjectId: T-001, decision: acknowledge}

  Note over A,B: Phase 2 — Proposal forming (S3 §IV.1.9-1.10)
  A->>ARepo: flyway_propose stage: driver
  B->>BRepo: flyway_respond decision: accept (no objections to advancing)
  A->>ARepo: flyway_propose stage: requirements
  B->>BRepo: flyway_respond decision: object {reason: premise + conclusion}
  Note over A,B: Phase 3 — Resolve Objections (S3 §IV.1.7)
  A->>ARepo: flyway_propose stage: refinement (integrates B's objection)
  B->>BRepo: flyway_respond decision: accept
  A->>ARepo: flyway_propose stage: draft
  B->>BRepo: flyway_respond decision: accept
  A->>ARepo: flyway_propose stage: final

  Note over A,B: Phase 4 — Sign (Consent reached)
  B->>BRepo: flyway_respond decision: accept
  A->>ARepo: write flyway/agreements/01HZ.yaml (signed by A)
  B->>BRepo: write flyway/agreements/01HZ.yaml (signed by B, byte-identical)
  Note over A,B: state: agreed
```

The byte-identity of `flyway/agreements/<id>.yaml` across both repos is
what "co-signed" means. There is no authoritative copy; each repo is.

For a **trial walkthrough** of this flow (3-party plus facilitator,
producing a real consent cycle including a textbook §IV.1.6 objection and
its §IV.1.7 integration), see
[`docs/walkthroughs/2026-05-13-3party-retrospective-cadence.md`](../walkthroughs/2026-05-13-3party-retrospective-cadence.md).

---

## 5. State machines

### 5.1 Identity

```mermaid
stateDiagram-v2
  [*] --> uninitialized
  uninitialized --> initialized: flyway_init
  initialized --> initialized: (future) key rotation
  initialized --> [*]: (future) revoked
```

### 5.2 Tension

```mermaid
stateDiagram-v2
  [*] --> open: flyway_tension raised
  open --> acknowledged: flyway_respond decision: acknowledge
  open --> disputed: flyway_respond decision: dispute (+ reason)
  open --> dissolved: flyway_respond decision: dissolve (+ reason)
  open --> transferred: flyway_respond decision: transfer (+ transferTo)
  acknowledged --> promoted: flyway_propose links via originTensionId
  promoted --> [*]
  disputed --> [*]
  dissolved --> [*]
  transferred --> [*]
```

### 5.3 Proposal (within an agreement)

```mermaid
stateDiagram-v2
  [*] --> driver: flyway_propose stage: driver
  driver --> requirements: peer accepts advancing
  requirements --> draft: peer accepts requirements
  draft --> refinement: any peer objects
  refinement --> refinement: more objections
  refinement --> final: all objections integrated
  draft --> final: no objections raised
  driver --> final: skip stages (small or routine)

  final --> signed: all peers consent
  final --> [*]: any peer exits
  signed --> [*]
```

Stages are **optional**: routine proposals can go straight to `final`.
Novel or high-stakes proposals walk through the earlier stages so
divergence surfaces cheaply before a fully-drafted proposal becomes hard
to revise.

### 5.4 Agreement (`FLYWAY_AGREEMENT_STATES`)

```mermaid
stateDiagram-v2
  [*] --> proposed: created via flyway_propose type: agreement
  proposed --> agreed: all participants sign
  proposed --> closed: exit before agreement
  agreed --> in_flight: start conditions met
  in_flight --> suspended: mutual pause
  suspended --> in_flight: resumed
  in_flight --> closed: exit, expiry, or mutual close
  agreed --> closed: exit before activation
  closed --> [*]
```

---

## 6. Contracts

### 6.1 Tool surface (9 tools)

| Tool               | Inputs (load-bearing)                                                          | Effect                                                                  |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `flyway_init`      | repoUrl, sourceName, mode                                                      | Generates DID + entity statement + ed25519 keypair (**implemented**)    |
| `flyway_status`    | (none)                                                                         | Reports current peers, agreements, open signals (not yet implemented)   |
| `flyway_discover`  | query, directoryUrl?                                                           | Looks up peers in a flyway directory (not yet implemented)              |
| `flyway_recognize` | peerDid, note?                                                                 | Proposes mutual recognition with a peer (not yet implemented)           |
| `flyway_tension`   | peerDid, conditions, effect, relevance?, proposedOwner?                        | Surfaces an S3 §IV.1.2 tension (not yet implemented)                    |
| `flyway_propose`   | peerDid, type, title, body, deadline?, stage?, previousStageId?                | Sends a directive/project/agreement at a given S3 stage (not yet impl.) |
| `flyway_respond`   | subjectId, decision, reason?, transferTo?                                      | Accepts/objects/exits a proposal or acknowledges/disputes a tension     |
| `flyway_check`     | since?, peerDid?                                                               | Reads unread incoming signals (not yet implemented)                     |
| `flyway_exit`      | target, targetType, reason?                                                    | Cleanly leaves a peer/project/syndicate (not yet implemented)           |

Schemas are exported as JSON Schema from `@murmurations-ai/flyway-core`
(`FLYWAY_TOOLS`) and as a `SKILL.md` document from
`@murmurations-ai/flyway-agent` (`FLYWAY_SKILL_MD`).

### 6.2 Agreement (`FLYWAY_AGREEMENT_SCHEMA`)

11 required fields mapped to the six S3 §IV.7.1 success criteria:

| Required field    | What it carries                                       | S3 grounding                       |
| ----------------- | ----------------------------------------------------- | ---------------------------------- |
| `id`              | Unique identifier (ULID/UUID/hash)                    | flyway bookkeeping                 |
| `schemaVersion`   | Agreement schema version                              | flyway bookkeeping                 |
| `createdAt`       | ISO 8601 datetime                                     | §IV.7.2                            |
| `participants[]`  | DIDs of Sources party to the agreement                | §IV.7.1 voluntary involvement      |
| `driver`          | {conditions, effect, relevance?}                      | §IV.1.3                            |
| `purpose`         | Intended outcome                                      | §IV.7.1 shared understanding       |
| `expectations[]`  | Per-participant commitments                           | §IV.7.1 "what is expected"         |
| `decisionRule`    | s3-consent (default) / lazy-consent / dual-source-sign / weighted-vote-bounded / apache-vote | flyway pluggability         |
| `review`          | {cadence, nextDate?, protocol?}                       | §IV.7.1 regular review meetings    |
| `exit`            | {notice, breach?, inFlightWork?}                      | §IV.7.1 termination protocol       |
| `state`           | proposed / agreed / in-flight / suspended / closed    | flyway lifecycle                   |

Plus optional `signatures[]` (required at state ≥ agreed),
`culture`, `term`, `metrics`, `disputeResolution`, `constraints`,
`concerns`. See
[`docs/concepts/agreement-template.md`](../concepts/agreement-template.md).

### 6.3 Entity statement (produced by `flyway_init`)

```typescript
interface EntityStatement {
  did: string                      // did:web:host:owner:repo
  sourceName: string               // human-readable
  mode: 'persistent' | 'interactive' | 'async' | 'ephemeral'
  flywayProtocolVersion: string    // 0.1.0
  createdAt: string                // ISO 8601
  verificationKeyId: string        // <did>#key-1
  toolsSupported: string[]         // ['flyway_init', ...]
  schemasSupported: string[]       // ['agreement@0.1.0']
}
```

### 6.4 DID document (produced by `flyway_init`)

W3C DID core + JsonWebKey2020 verification method. Resolves at
`https://<host>/<path-with-slashes>/.well-known/did.json`. For
GitHub-hosted Sources this requires GitHub Pages (or a custom resolver
that fetches raw content). DID resolution is the Source's
responsibility — the flyway protocol just writes the file.

### 6.5 Invariants (enforced by convention; future: by code)

1. **Source sovereignty.** No tool can override a Source's authority
   over what their murmuration accepts, forwards, recognizes, or
   commits to.
2. **Achieve consent; never force agreement.** The protocol's response
   cycle exists to integrate objections into a stronger proposal, not
   to bully one through.
3. **Exit follows process.** Exit is always a valid outcome, but it
   ends a good-faith consent-seeking effort — never substitutes for
   one.
4. **No proposals to unrecognized peers.** `flyway_propose` requires
   the peer to be in `flyway/peers.yaml`.
5. **Respond to everything.** Silence is not a valid protocol state.
6. **Cryptographic identity.** Every Source action that affects another
   party is (will be) signed by the Source's private key. The public
   key lives in the DID document.
7. **Append-only history.** Decisions, once made, are recorded
   immutably and replayable from each repo.

---

## 7. Reading further

- [`docs/adr/`](../adr/) — architectural decisions, in order
- [`docs/concepts/`](../concepts/) — Source, S3, consent mechanisms, agreement template, canonical S3 PDF
- [`docs/walkthroughs/`](../walkthroughs/) — protocol traces of real consent cycles
- [`docs/retrospectives/`](../retrospectives/) — honest looks at build cycles
- [`packages/core/src/`](../../packages/core/src/) — types, schemas, pure logic
- [`packages/cli/src/`](../../packages/cli/src/) — `flyway init`, `flyway skill ...`
- [`packages/mcp/src/`](../../packages/mcp/src/) — MCP server exposing the 9 tools

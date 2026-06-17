![Three independent starling murmurations — a flowing wave, a curling spiral, and a long ribbon — sharing the same migration corridor at golden hour, with faint threads of light suggesting mutual awareness across the open sky.](./assets/banner.jpg)

# flyway

**A runtime-agnostic protocol for collaboration between independent AI-agent murmurations.**

flyway is the shared corridor that lets autonomous murmurations discover one another, recognize each other, exchange signals, and coordinate work without surrendering sovereignty to a central controller.

**Status (June 2026 · SHA `11c6b0d`):** see [`docs/status.md`](./docs/status.md) for the full dashboard ([visual companion](./docs/status.html)). In short: the protocol surface, agent skill, and MCP server are wired, typed, and tested. Eight of the nine tools run end-to-end: **`flyway_init`** produces a cryptographically signed identity (DID document, EdDSA-signed entity statement, ed25519 keypair); **`flyway_status`** reads it back and verifies signatures; **`flyway_recognize`** (+ `unrecognize`) writes signed peer-recognition entries; **`flyway_check`** reads and verifies incoming signals; **`flyway_tension`** signs and delivers the first cross-murmuration signal envelope (S3 *Navigate via Tension*); **`flyway_respond`** completes the round-trip on both tensions (`acknowledge` / `dispute` / `dissolve` / `transfer`) and proposals (`accept` / `object` / `exit`); **`flyway_propose`** drives the full S3 staging chain (driver → requirements → draft → refinement → final), and an accepted final-stage agreement is **materialized into a byte-identical co-signed `flyway/agreements/<id>.yaml`** on both repos (`flyway materialize`); and **`flyway_exit`** delivers a signed, unilateral clean exit that no peer can prevent. Signals travel via the ADR-0008 local-fs transport. Signing is pluggable through the `Signer` interface ([ADR-0007](./docs/adr/0007-pluggable-signers-and-anchors.md)); a future `flyway-cardano` package will add a Cardano-resident signer and on-chain anchoring without touching `flyway-core`. Only **`flyway_discover`** still returns "not yet implemented" — that's the next milestone.

## What Is A Murmuration?

A murmuration is any agent swarm controlled by a human **Source**.

> **Source** is used here in the sense developed by [Peter Koenig](https://www.tomnixon.co.uk/) and popularized in Tom Nixon's *Work with Source* (2021): the person who first takes the initiative and the risk on an idea, and who holds the vision, authority, and accountability for it. See [`docs/concepts/defining-source.md`](./docs/concepts/defining-source.md) for a primer and links to the source material.

A murmuration might be:

- a `murmurations-harness` installation
- a Claude Code session with subagents
- a Cursor or IDE-based agent workflow
- an OpenClaw agent reached through chat
- a Source scripting agents directly against LLM APIs
- a human using GitHub manually as the system of record

The unifying property is not the runtime. It is a Source whose authority is anchored in a Git-addressable project, with agents or tools acting under that authority.

## What flyway Does

flyway exists to support collaboration **between** murmurations.

It provides a protocol layer for independent Sources to:

- discover one another
- verify identity and trust
- exchange directives, signals, or governance events
- agree on cross-boundary conventions
- run cross-murmuration governance rounds
- coordinate shared projects or ongoing syndicates
- exit cleanly when collaboration ends or consent fails

## What flyway Is Not

flyway is not:

- a master controller above murmurations
- a central authority
- a runtime or required daemon
- harness-specific
- a dependency of `murmurations-harness`
- a mechanism for **forcing** agreement between sovereign Sources

## What flyway Is For

flyway exists to help sovereign Sources **achieve consent** — surface
objections, integrate concerns, and reach agreements every party can stand
behind. The distinction from forced agreement is load-bearing: forcing
agreement overrides one Source's authority for another's benefit; achieving
consent does the work of finding what all parties can support.

flyway provides explicit primitives for that work: structured proposals,
named objections with reasoning, response cycles, pluggable decision rules
(S3 consent by default, lazy consent, dual-source sign, and others), and
a graduated escalation ladder for tensions that don't resolve quickly.

When consent genuinely cannot be reached after good-faith effort, exit is
a valid outcome — but exit is the *end* of a process, not a substitute
for one. Silence is never a valid protocol state.

## Design Principles

### Source Sovereignty

Each murmuration's Source retains authority over:

- who they federate with
- what signals they accept
- what their agents do
- what agreements they enter
- when they exit

### Runtime Independence

flyway must work across different agent runtimes and tools. The protocol should not leak assumptions from `murmurations-harness`, Claude Code, Cursor, OpenClaw, or any other client.

### Git As System Of Record

Each murmuration controls its own authoritative repo. Other murmurations may cache, reference, or propose changes, but they do not overwrite another Source's state.

### Peer Coordination, Not Control

flyway coordinates peers. It does not create a hierarchy above them.

### Small Protocol, Strong Conventions

The goal is not novel infrastructure. The goal is a small set of explicit conventions for identity, recognition, engagement, governance, and exit.

## Shape

flyway is delivered as a small TypeScript monorepo with five packages, each
covering one role in the protocol stack:

| Package                              | Role                                                                                                                                  | Status   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `@murmurations-ai/flyway-core`       | Canonical tool definitions (JSON Schema), protocol instructions, skill factory. Runtime-agnostic — no Node-only or runtime-specific deps. | Wired    |
| `@murmurations-ai/flyway-agent`      | Spec-compliant [Agent Skills IO](https://agentskills.io) `SKILL.md` generator. Install one folder, participate from Claude Code, Cursor, VS Code Copilot, Gemini CLI, OpenAI Codex, Goose, Roo Code, and 30+ other agent environments. | Wired    |
| `@murmurations-ai/flyway-mcp`        | MCP server (stdio) exposing the eight flyway tools to any MCP-capable client.                                                         | Wired    |
| `@murmurations-ai/flyway-cli`        | Terminal CLI. `flyway init` generates an identity; `flyway skill list / install / uninstall` manages installed skills.                 | Wired    |
| `@murmurations-ai/flyway-harness`    | `murmurations-harness` adapter.                                                                                                       | Stub     |

None of these clients is privileged. They are different ways for a Source to
participate in the same protocol — the agent skill is the primary interface
([ADR-0004](./docs/adr/0004-agent-skill-as-primary-protocol-interface.md));
everything else is a delivery adapter for the same canonical schemas in
`flyway-core`.

## Emerging Protocol Concepts

Current research points toward these primitives:

- **Identity:** `did:web` rooted in a Source-controlled repo
- **Entity statements:** signed metadata inspired by OpenID Federation
- **Discovery:** thin GitHub-hosted directories plus operator-run aggregators
- **Recognition:** explicit pairwise recognition between Sources
- **Engagement agreements:** per-peer or per-project rules committed to participating repos
- **Governance:** S3-style consent by default, pluggable per agreement
- **Exit:** clean unilateral exit as a first-class right

## Relationship To murmurations-harness

[`murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness) is a runtime for coordinating agents within one murmuration.

flyway is the protocol for coordinating between murmurations.

The harness should remain useful without flyway. flyway should remain useful without the harness.

## The nine flyway tools

The protocol surface is nine tools, defined once in `flyway-core` and exposed
through every adapter without rewriting:

| Tool               | Purpose                                                                                       | Status         |
| ------------------ | --------------------------------------------------------------------------------------------- | -------------- |
| `flyway_init`      | Initialize this murmuration's identity (DID + entity statement)                               | Wired          |
| `flyway_status`    | Report current peers, agreements, and open signals                                            | Wired          |
| `flyway_discover`  | Look up murmurations in a flyway directory                                                    | Not yet wired  |
| `flyway_recognize` | Propose mutual recognition with a peer                                                        | Wired          |
| `flyway_tension`   | Flag a tension to a peer — pre-proposal observation (S3 Navigate via Tension)                 | Wired          |
| `flyway_propose`   | Send a directive, project, or engagement agreement to a peer                                  | Not yet wired  |
| `flyway_respond`   | Respond to a proposal (accept/object/exit) or tension (acknowledge/dispute/dissolve/transfer) | Wired (tensions only) |
| `flyway_check`     | Read incoming flyway signals from peers                                                       | Wired          |
| `flyway_exit`      | Cleanly leave a peer relationship, project, or syndicate                                      | Not yet wired  |

The schemas, descriptions, and protocol instructions are the authoritative
specification. There is no separate spec document at v0.1.

## Repository layout

```
flyway/
├── docs/
│   ├── adr/                # Architecture decision records (8 accepted)
│   ├── concepts/           # Foundational primers (Source, S3, consent mechanisms)
│   └── research/           # Pre-implementation research synthesis
├── packages/
│   ├── core/               # @murmurations-ai/flyway-core
│   ├── agent/              # @murmurations-ai/flyway-agent
│   ├── mcp/                # @murmurations-ai/flyway-mcp
│   ├── cli/                # @murmurations-ai/flyway-cli (stub)
│   └── harness/            # @murmurations-ai/flyway-harness (stub)
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Where to start (for reviewers):**

- [`docs/status.md`](./docs/status.md) — current status dashboard ([visual](./docs/status.html)): tools wired, milestones, walkthroughs, open issues, ADR digest.
- [`docs/architecture/how-flyway-works.md`](./docs/architecture/how-flyway-works.md) — concrete sequence diagrams, state machines, and contracts. Versioned against code SHA. A visual companion with hand-crafted SVG diagrams lives at [`docs/architecture/how-flyway-works.html`](./docs/architecture/how-flyway-works.html) (open in a browser).
- [`docs/walkthroughs/`](./docs/walkthroughs/) — three executable walkthroughs (Tier 1 / 2 / 3) prove the protocol carries real cross-murmuration acts end-to-end.

Accepted ADRs:

- [ADR-0001](./docs/adr/0001-project-framing-and-scope.md) — project framing and scope
- [ADR-0002](./docs/adr/0002-typescript-as-implementation-language.md) — TypeScript as implementation language
- [ADR-0003](./docs/adr/0003-monorepo-layout.md) — pnpm monorepo layout
- [ADR-0004](./docs/adr/0004-agent-skill-as-primary-protocol-interface.md) — agent skill as the primary protocol interface
- [ADR-0005](./docs/adr/0005-s3-patterns-as-canonical-protocol-vocabulary.md) — S3 patterns as canonical protocol vocabulary
- [ADR-0006](./docs/adr/0006-skill-distribution-and-installation.md) — skill distribution and installation
- [ADR-0007](./docs/adr/0007-pluggable-signers-and-anchors.md) — pluggable signers and on-chain anchoring (optional)
- [ADR-0008](./docs/adr/0008-signal-transport-convention.md) — signal transport convention (envelope + inbox/outbox + pluggable transports)
- [ADR-0009](./docs/adr/0009-antecedent-verification-before-signing.md) — antecedent verification before signing (the rule lives in core; adapters can't skip it)

## MVP Direction

The MVP is a cross-runtime demonstration:

> mirrored cross-murmuration directives between one `murmurations-harness` installation and one Agent Skills IO–compatible agent (Claude Code, Cursor, etc.).

This intentionally proves flyway is not a harness feature — it is a protocol
that different runtimes can speak. The wiring (tool schemas, agent skill, MCP
server, monorepo) is in place; the next milestone implements the actual tool
behaviour in `flyway-core`.

## Name

A flyway is an ornithological term for a shared migration corridor used by many independent flocks.

That is the intended posture of this project:

- shared route
- no central authority
- autonomy preserved
- coordination by agreement

## License

See `LICENSE`.

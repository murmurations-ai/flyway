# flyway

**A runtime-agnostic protocol for collaboration between independent AI-agent murmurations.**

flyway is the shared corridor that lets autonomous murmurations discover one another, recognize each other, exchange signals, and coordinate work without surrendering sovereignty to a central controller.

The project is currently in the **framing and research stage**. There is no implementation yet.

## What Is A Murmuration?

A murmuration is any agent swarm controlled by a human **Source**. The Source holds the vision, authority, and accountability for the system.

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
- a mechanism for forcing agreement between sovereign Sources

When Sources do not agree, the correct outcome is **no joint action**.

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

## Proposed Shape

flyway is expected to include:

- a protocol specification
- a reference TypeScript implementation, likely `@murmurations-ai/flyway-core`
- client integrations, including:
  - a `murmurations-harness` adapter
  - a Claude Code skill
  - a generic MCP server
  - a CLI
  - chat-client adapter patterns

None of these clients is privileged. They are different ways for a Source to participate in the same protocol.

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

## Current Repository Status

This repository currently contains design and research material only:

- `docs/adr/0001-project-framing-and-scope.md` — project identity, scope, and non-goals
- `docs/adr/0002-typescript-as-implementation-language.md` — TypeScript as implementation language
- `docs/research/2026-04-27-multi-murmuration-collaboration.md` — synthesis paper
- `docs/research/federation-protocols-survey.md` — federation protocol research
- `docs/research/governance-models-survey.md` — governance model research
- `docs/research/harness-primitives-audit.md` — harness extension point audit

## MVP Direction

The proposed MVP is a cross-runtime demonstration:

> mirrored cross-murmuration directives between one `murmurations-harness` installation and one Claude Code session.

This intentionally proves that flyway is not merely a harness feature. It is a protocol that different runtimes can speak.

## Name

A flyway is an ornithological term for a shared migration corridor used by many independent flocks.

That is the intended posture of this project:

- shared route
- no central authority
- autonomy preserved
- coordination by agreement

## License

See `LICENSE`.

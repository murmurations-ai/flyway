# ADR-0001 — Project framing & scope

- **Status:** Accepted
- **Date:** 2026-04-27
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

> **Amendment 2026-04-27 (same day):** Original draft scoped flyway to the murmurations-harness as the assumed runtime. Source clarified the project must be runtime-agnostic — a *murmuration* is any agent swarm controlled by a Source, and flyway must support participants regardless of tool (harness, Claude Code, Cursor, OpenClaw, raw GitHub, …). The Context, Decision, and Consequences sections have been amended to reflect this.

## Context

This is the first ADR for [`murmurations-ai/flyway`](https://github.com/murmurations-ai/flyway). The project is brand new — empty repo, no scaffolding beyond this ADR log. Before any technical decisions, we need to fix the project's identity, scope, and relationship to the broader ecosystem of agent-coordination tools.

A *murmuration* is any agent swarm controlled by a Source — a human operator. The murmurations-harness ([`murmurations-ai/murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness)) is one canonical operationalization: a generic agent-coordination runtime with one daemon, one murmuration per installation, pluggable governance. Its first operator is Emergent Praxis (`xeeban/emergent-praxis`). The harness has never been about coordinating *between* murmurations — that is a deliberate scope cap, called out in the harness's `CLAUDE.md` ("zero EP-specific references in `packages/`; multi-murmuration coordination is out of scope for v0.1").

But the harness is not the only way to operationalize a murmuration. A Source running Claude Code with sub-agents, a developer using Cursor with embedded agent tooling, an OpenClaw agent reached through a chat client, or a person scripting agents directly against an LLM API — all of these are equally valid murmurations in the conceptual sense. They all have a Source whose authority is anchored at a Git-addressable repo, and they all have agents (or no agents — just the Source) acting under that authority.

flyway exists to fill the cross-murmuration scope gap, regardless of how any particular murmuration is operationalized.

## Decision

**flyway is a runtime-agnostic protocol for cross-murmuration collaboration.** It is the shared migration corridor that independent Sources — running whatever agent tooling they prefer — may use to:

- discover one another (registry / lookup)
- exchange signals, directives, or governance events across murmuration boundaries (protocol)
- agree on cross-boundary conventions (schemas, identity, trust)
- run cross-murmuration governance rounds when the participating Sources consent to it

flyway is delivered as:

- a **protocol specification** (the contract; tool-independent),
- a **reference TypeScript implementation** (`@murmurations-ai/flyway-core`),
- a **family of client integrations** — including a harness adapter, a Claude Code skill, a generic MCP server, a CLI, and a chat-client adapter pattern — none of which is privileged.

flyway is **not**:

- a controller, orchestrator, or master node above murmurations — peer coordination only, no central authority
- harness-specific — the harness is one of several first-class client integrations
- a hard dependency of the harness, Claude Code, Cursor, OpenClaw, or any other tool — the harness must continue to ship and run as a single-murmuration runtime with no flyway involvement, and the same is true of every other agent-coordination tool
- a runtime — there is no "flyway daemon" required for participation

**Naming:** "flyway" is the ornithological term for a shared migration corridor used by many independent flocks. The semantic load — *shared route, no central authority, autonomy preserved* — matches the project's intended posture. It also distinguishes the coordination layer from a single murmuration in conversation: "your murmuration uses the flyway."

## Consequences

**Positive:**

- Project identity is fixed before code lands. The first contributor (human or agent) reads this and knows what flyway is and isn't.
- Harness scope stays clean. The harness's "zero coordination layer" cap is preserved — flyway, not the harness, takes on multi-murmuration concerns.
- Sources can adopt the harness without adopting flyway, and vice versa as the protocol matures. Independent ship paths.
- **Runtime independence is a feature.** A Source can switch from Claude Code to the harness (or vice versa) without losing identity, agreements, or in-flight work — the protocol artifacts live in the Source's repo, not in any tool's local state.

**Negative:**

- We commit to the name "flyway" before the project's actual primitives are designed. If the operational shape later turns out to be more "registry" than "corridor," the name may feel stretched.
- Adopting MADR + the harness's pre-flight check rule is upfront process for a project that has zero implementation. Risk of being heavier than the work warrants in the first 1–2 ADRs.
- Runtime-agnostic design is more work than runtime-specific design. The protocol must avoid leaking harness assumptions, which constrains what we can rely on from any single tool. We trade design effort upfront for not having to rebuild the protocol when the second runtime joins.

**Reversibility:**

- High for the name (rename is a `gh repo rename` plus links update).
- Low for the scope split between harness and flyway (this defines what each repo is *for*; reversing it would mean either folding flyway into the harness or pulling coordination logic out of the harness — both significant migrations).
- Medium for the runtime-agnostic stance. Going from runtime-agnostic to harness-only later is feasible (deprecate other clients). Going from harness-only to runtime-agnostic later would require redesigning the protocol layer to remove harness assumptions — much harder.

## Alternatives considered

1. **Keep multi-murmuration coordination inside the harness as a separate package.** Rejected because the harness's ship bar is "second murmuration installs it as a single-murmuration runtime." Adding a coordination layer to the harness changes the install footprint, the security model, and the dependency graph. Cleaner to keep them separate and let operators opt in.

2. **Defer the framing decision; just start coding.** Rejected because the harness's 2026-04-18→2026-04-27 incidents (ADR collisions, blind agents, label drift) all stemmed from skipped framing decisions early on. A 1-page ADR now is cheaper than re-deciding later.

3. **Call the project something other than "flyway."** Considered: `roost`, `canopy`, `chorus`, `kettle`. Rejected in favor of `flyway` because it most cleanly carries the "shared corridor for autonomous flocks" semantic and is one syllable / one Git path segment.

## Links

- [`murmurations-ai/murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness) — the runtime each individual murmuration runs on
- [`murmurations-ai/murmurations-harness#228`](https://github.com/murmurations-ai/murmurations-harness/pull/228) — ADR collision incident dedupe; source of the pre-flight check pattern adopted in `docs/adr/README.md`
- [`xeeban/emergent-praxis`](https://github.com/xeeban/emergent-praxis) — the first operator murmuration; reference shape of what flyway will coordinate between
- [murmurations.network](https://murmurations.network/) — separate, adjacent open-data project sharing the metaphor; not directly related to this work

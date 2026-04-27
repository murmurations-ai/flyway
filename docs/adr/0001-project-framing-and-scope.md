# ADR-0001 — Project framing & scope

- **Status:** Proposed
- **Date:** 2026-04-27
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

This is the first ADR for [`murmurations-ai/flyway`](https://github.com/murmurations-ai/flyway). The project is brand new — empty repo, no scaffolding beyond this ADR log. Before any technical decisions, we need to fix the project's identity, scope, and relationship to the existing harness.

The harness ([`murmurations-ai/murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness)) is a generic agent-coordination runtime — one daemon, one murmuration, pluggable governance. Its first operator is Emergent Praxis (`xeeban/emergent-praxis`). The harness has never been about coordinating *between* murmurations — that is a deliberate scope cap, called out in the harness's `CLAUDE.md` ("zero EP-specific references in `packages/`; multi-murmuration coordination is out of scope for v0.1").

flyway exists to fill that scope gap: the layer above any single murmuration, where multiple independent murmurations discover, communicate, and coordinate without ceding autonomy.

## Decision

**flyway is a coordination layer for AI-agent murmurations.** It is the shared migration corridor that independent murmurations may use to:

- discover one another (registry / lookup)
- exchange signals, directives, or governance events across murmuration boundaries (protocol)
- agree on cross-boundary conventions (schemas, identity, trust)
- run cross-murmuration governance rounds when the participating murmurations consent to it

flyway is **not**:

- a controller, orchestrator, or master node above murmurations — peer coordination only, no central authority
- a hard dependency of the harness — the harness must continue to ship and run as a single-murmuration runtime with no flyway involvement

**Naming:** "flyway" is the ornithological term for a shared migration corridor used by many independent flocks. The semantic load — *shared route, no central authority, autonomy preserved* — matches the project's intended posture. It also distinguishes the coordination layer from a single murmuration in conversation: "your murmuration uses the flyway."

## Consequences

**Positive:**

- Project identity is fixed before code lands. The first contributor (human or agent) reads this and knows what flyway is and isn't.
- Harness scope stays clean. The harness's "zero coordination layer" cap is preserved — flyway, not the harness, takes on multi-murmuration concerns.
- Operators can adopt the harness without adopting flyway, and vice versa as the protocol matures. Independent ship paths.

**Negative:**

- We commit to the name "flyway" before the project's actual primitives are designed. If the operational shape later turns out to be more "registry" than "corridor," the name may feel stretched.
- Adopting MADR + the harness's pre-flight check rule is upfront process for a project that has zero implementation. Risk of being heavier than the work warrants in the first 1–2 ADRs.

**Reversibility:**

- High for the name (rename is a `gh repo rename` plus links update).
- Low for the scope split between harness and flyway (this defines what each repo is *for*; reversing it would mean either folding flyway into the harness or pulling coordination logic out of the harness — both significant migrations).

## Alternatives considered

1. **Keep multi-murmuration coordination inside the harness as a separate package.** Rejected because the harness's ship bar is "second murmuration installs it as a single-murmuration runtime." Adding a coordination layer to the harness changes the install footprint, the security model, and the dependency graph. Cleaner to keep them separate and let operators opt in.

2. **Defer the framing decision; just start coding.** Rejected because the harness's 2026-04-18→2026-04-27 incidents (ADR collisions, blind agents, label drift) all stemmed from skipped framing decisions early on. A 1-page ADR now is cheaper than re-deciding later.

3. **Call the project something other than "flyway."** Considered: `roost`, `canopy`, `chorus`, `kettle`. Rejected in favor of `flyway` because it most cleanly carries the "shared corridor for autonomous flocks" semantic and is one syllable / one Git path segment.

## Links

- [`murmurations-ai/murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness) — the runtime each individual murmuration runs on
- [`murmurations-ai/murmurations-harness#228`](https://github.com/murmurations-ai/murmurations-harness/pull/228) — ADR collision incident dedupe; source of the pre-flight check pattern adopted in `docs/adr/README.md`
- [`xeeban/emergent-praxis`](https://github.com/xeeban/emergent-praxis) — the first operator murmuration; reference shape of what flyway will coordinate between
- [murmurations.network](https://murmurations.network/) — separate, adjacent open-data project sharing the metaphor; not directly related to this work

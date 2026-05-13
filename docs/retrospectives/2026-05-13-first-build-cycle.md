---
date: 2026-05-13
protocol-version: 0.1.0
code-sha: 12f48e4
scope: First build cycle (2026-04-27 → 2026-05-13) — research-only repo through Tier 1 completion of ADR-0005
author: Source (Nori / Kozan)
---

# Flyway retrospective — first build cycle

**Scope:** 2026-04-27 → 2026-05-13. From research-only repo to a typed
protocol with one trial walkthrough completed.

---

## What we shipped

| Layer                                | State                                                  |
| ------------------------------------ | ------------------------------------------------------ |
| 5 ADRs                               | All accepted                                           |
| 9 protocol tools                     | Defined, typed, schema-stable                          |
| Agent Skills IO `SKILL.md`           | Generated, spec-compliant                              |
| MCP server                           | Working over stdio, smoke-tested                       |
| Agreement schema                     | 11 required fields, S3-mapped, tested                  |
| Reference docs (`docs/concepts/`)    | Source, S3, consent mechanisms, agreement template     |
| Canonical reference                  | S3 Practical Guide v2026-01-26 bundled                 |
| Tier 1 of ADR-0005                   | All 4 sub-tasks landed                                 |
| Tests                                | 40/40 passing                                          |
| Trial walkthrough (`walkthroughs/`)  | 3-party + facilitator; consent reached after one cycle |
| Issues filed from trial              | 8, each linked to surfacing evidence                   |

Aggregate output is small (12 commits since the scaffold) but coherent.

---

## What's working well

### ADR-first discipline

Every architectural decision was recorded before code. When framing
needed to evolve — the "no joint action" → "achieve consent" reframe;
the Navigate-via-Tension shape; the `flyway-claude-code` →
`flyway-agent` rename — prior ADRs were the substrate, not bystanders.
The ADR log is the system's institutional memory.

### Real intellectual grounding, not invention

The protocol stands on three external pillars:

- Sociocracy 3.0 (Bockelbrink/Priest/David), bundled as canonical PDF
- Source theory (Koenig/Nixon), documented in `defining-source.md`
- Agent Skills IO (Anthropic-originated open standard)

Every paraphrased S3 pattern carries a § citation and dual-license
attribution. The walkthrough validated that this grounding gives agents
real reasoning surface, not just vocabulary.

### Tests pin the canonical vocabulary

`expect(instructions).toContain('§IV.1.5')`,
`expect(decisionRule.enum).toEqual(FLYWAY_DECISION_RULES)`. These look
trivial but they are load-bearing — they mean the protocol vocabulary
cannot silently drift away from what was documented. 40 such pins.

### Clean separation of surface and substance

The 9 tools are the surface; the instructions + agreement schema are
the substance. We refined substance multiple times without touching
surface (consent reframe, S3 grounding, walkthrough revisions). That
separation showed its value repeatedly.

### The Agent Skills IO pivot

Started with three provider-specific adapters (Anthropic / OpenAI /
Gemini). Discovered agentskills.io is the open standard adopted by 30+
environments. Dropped the adapters. Net result: less code, broader
reach. The single best architectural decision in the cycle.

### The trial walkthrough actually worked

Three independent subagents with distinct dispositions produced three
distinct, well-reasoned, non-pre-softened positions. The facilitator
integrated them into a two-layer structure none of them suggested
individually. Source C raised a textbook §IV.1.6 objection; the §IV.1.7
cycle resolved it cleanly. **Empirical validation, not claimed
validation.** The protocol carries real consent dynamics.

### Walkthrough → versioned doc → issues pattern

Built once, will pay dividends every time a protocol revision needs
trialing. Walkthroughs are evidence; issues are tracked work; ADRs
record decisions. The triple reinforces.

---

## What still needs work — honest

### 1. No actual tool execution ⚠️

**The largest gap.** Every tool returns "not yet implemented." The
protocol *describes* what should happen with precision; nothing happens
when an agent calls a tool. Beautifully-typed inert artifact. Until
`flyway_init` writes an actual DID document to a real repo, this is
specification, not system.

### 2. The 2-party ceiling

Issues [#1](https://github.com/murmurations-ai/flyway/issues/1) +
[#5](https://github.com/murmurations-ai/flyway/issues/5). The trial
revealed multi-party consent flow is unspecified and `flyway_propose`
is hard-coded to a singular `peerDid`. Blocks the most interesting use
case — syndicates — and tier-2 features should not land before this is
resolved.

### 3. No real-world peer test

The walkthrough was three subagents on the same machine with context
provided by the orchestrator. A real test would be two physical
machines, two real Sources, two real repos, GitHub as the only shared
substrate. This will reveal things subagents can't (timing, file
conflicts, partial-state recovery, network artifacts).

### 4. `flyway-cli` and `flyway-harness` are stubs

Two of five packages don't do anything. `flyway-harness` in particular
is the bridge to the runtime ecosystem we're nominally not coupled to —
the bridge being a stub means we haven't actually tested the
runtime-independence claim.

### 5. No identity / signing infrastructure

Agreement schema has `signatures: []`; the protocol talks about
cryptographic identity; we have no signing tooling, no DID resolution,
no signature verification. The protocol assumes infrastructure we
haven't built.

### 6. No deployment story

Nothing is published to npm. The skill is not installed anywhere. The
MCP server is not registered with any client. We have not tried
*operating* an instance.

### 7. Tier 2 + Tier 3 unstarted

Seven Principles, Meeting Practices, Peer Development patterns are not
in the skill. Building Organizations / Org Structure reference docs do
not exist yet.

### 8. Single-perspective design

All 5 ADRs are decided by one Source with one AI assistant.
"Consulted: —" every time. The protocol's premise is multi-perspective
consent, and we haven't actually applied that *to* flyway's own design.

### 9. Adversarial cases unconsidered

Many invariants ("Source sovereignty," "silence harms," "object with
reason") assume the agent is operating honestly. A misaligned agent
that pretends concerns are objections (or vice versa) could degrade
the protocol. No threat model yet.

### 10. Deferred cleanup

`vitest.workspace.ts` deprecation warning noted multiple times, never
fixed. Small, but a tell — we let known cleanup slide when forward
momentum was the priority.

---

## Patterns observed

**A. "Design with subagents, code with discipline" works.** When
independent reasoning was the deliverable, subagents produced diverse,
useful output. When code was the deliverable, careful TypeScript with
pinning tests produced durable artifacts. The two modes are
complementary and we used them well.

**B. The ADR ↔ code ↔ docs triple is reinforcing.** Almost every
change touched all three. None of the three is canonical alone;
together they are the system. This is the right rhythm.

**C. Tight feedback loops correlate with progress velocity.** Fastest
progress: write code → run tests → commit. Slowest moments: extended
design discussion without a concrete next artifact (the banner image
iteration is the cleanest example of "fine to do, but not progress").

**D. Real intellectual grounding multiplies depth.** Bundling the S3
PDF gave every paraphrase a citation. Without it, the protocol
vocabulary would feel invented. With it, the protocol stands on
shoulders we trust.

**E. Pivots, when they came, were good.** Three notable ones in this
cycle — provider adapters → Agent Skills IO; "no joint action" →
"achieve consent"; runtime-specific `flyway-claude-code` →
runtime-agnostic `flyway-agent`. Each pivot made the system simpler
and broader.

---

## Recommendations forward

In rough priority:

1. **Pick one tool and make it actually work.** `flyway_init` is the
   natural first candidate — clear inputs, defined output (DID document
   + entity statement), no peer-infrastructure dependency. Implementing
   it forces all the open infrastructure questions (signing, file
   writing, identity) and produces the first thing flyway *does* rather
   than *describes*.

2. **Close issues #1 + #5 before any Tier 2 work.** Multi-party support
   and consent flow are foundational. Doing Tier 2 features over a
   2-party-only base means rework.

3. **Run a real two-machine trial.** Two different physical machines,
   two real Sources, two real repos, GitHub as the only shared
   substrate. This is the test that distinguishes "the protocol is
   well-specified" from "the protocol works."

4. **Find a second human Source.** Right now there is one AI in the
   loop and one human Source making decisions. The protocol is *about*
   multi-source consent. Get someone real to actually consent or object
   to the design. Eat our own dog food.

5. **Migrate `vitest.workspace.ts`.** Smallest known cleanup. Stop
   deferring it.

6. **Status discipline.** The README currently says "working scaffold."
   That is correct, but the next phrase should be louder: *"tool
   execution is unimplemented; flyway today is a protocol specification
   with a typed reference, not a running system."* Let readers
   calibrate.

---

## One sentence

flyway has earned the right to call itself a *coherent protocol
specification with a typed reference* and a *single empirically-validated
consent cycle*; it has not yet earned the right to call itself a
*running system*. The next milestone is the smallest one that crosses
that line.

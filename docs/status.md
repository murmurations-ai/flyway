---
date: 2026-05-25
protocol-version: 0.1.0
code-sha: d5ad56f
purpose: project status snapshot for reviewers
audience: external reviewers, peer Sources, and anyone evaluating flyway for adoption
---

# flyway — Status snapshot

> **One-line headline.** Six of nine protocol tools wired and exercised end-to-end. Two
> independent murmurations can now establish mutual recognition, exchange a tension, and
> complete a full S3 navigate-via-tension dialogue with cryptographic verification on both
> sides — proven by an executable walkthrough at SHA [`d5ad56f`](../).

A visual companion lives at [`docs/status.html`](./status.html) — same content, browser-rendered.

---

## At a glance

| | |
| --- | --- |
| **Protocol version** | 0.1.0 |
| **Code SHA** | `d5ad56f` |
| **Tools wired (end-to-end)** | 6 of 9 |
| **Executable walkthroughs** | 3 (Tier 1, Tier 2, Tier 3) |
| **ADRs accepted** | 9 |
| **Tests passing** | 221 across 18 test files |
| **Open issues** | 19 (4 from Tier 1, 12 filed today after 3-agent review, 3 historical) |
| **Open security findings** | 0 (all high/medium-severity items from the security review are resolved) |

---

## Tool maturity

The protocol surface is **nine typed tools** defined once in `flyway-core` and exposed
through every adapter (agent skill, MCP server, CLI) without rewriting. Status of each:

| # | Tool | Purpose | Status | Demo |
| - | ---- | ------- | ------ | ---- |
| 1 | `flyway_init` | Initialize the murmuration's identity — DID document + signed entity statement + Ed25519 keypair | ✅ **Wired** | [Tier 1](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) |
| 2 | `flyway_status` | Report identity + peers + agreements + signature validity | ✅ **Wired** | [Tier 1](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) |
| 3 | `flyway_discover` | Look up murmurations in a flyway directory | ⏳ Not yet wired | — |
| 4 | `flyway_recognize` (+ `unrecognize`) | Verify a peer's identity and produce a signed recognition entry | ✅ **Wired** | [Tier 1](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) |
| 5 | `flyway_tension` | Flag a tension to a recognized peer (S3 *Navigate via Tension*) | ✅ **Wired** | [Tier 2](./walkthroughs/2026-05-25-tier2-signal-exchange.md) |
| 6 | `flyway_propose` | Send a directive, project, or engagement agreement | ⏳ Not yet wired | — |
| 7 | `flyway_respond` | Respond to a tension (`acknowledge` / `dispute` / `dissolve` / `transfer`) | ✅ **Wired** (tensions only) | [Tier 3](./walkthroughs/2026-05-25-tier3-signal-dialogue.md) |
| 8 | `flyway_check` | Read incoming flyway signals from peers; verify signatures and flag issues | ✅ **Wired** | [Tier 2](./walkthroughs/2026-05-25-tier2-signal-exchange.md) |
| 9 | `flyway_exit` | Cleanly leave a peer relationship, project, or syndicate | ⏳ Not yet wired | — |

**Status legend:** ✅ wired = runs end-to-end with tests and at least one executable walkthrough. ⏳ not yet wired = JSON schema defined; tool returns "not yet implemented."

---

## Milestone timeline

Each milestone produces *behaviour*, not just code — the cadence is implement → walkthrough → review → harden.

| Milestone | SHA | Date | What it produced | Walkthrough |
| --------- | --- | ---- | ---------------- | ----------- |
| **S+0** — protocol surface | `02e1bfa` | 2026-05-13 | 9 tool schemas, agent skill, MCP server, CLI scaffolding | 3-party retrospective cadence (narrative) |
| **S+1** — identity + recognition | `1712232` → `f9911fd` | 2026-05-21 | `flyway_init`, `flyway_status`, `flyway_recognize` (+ `unrecognize`) with full signing under domain-separated EdDSA; signed entity statements; signed recognition entries with inline peer-key binding | Tier 1 — mutual recognition |
| **S+2** — signal transport | `3ce02ec` → `4c472e7` | 2026-05-21 | Signed signal envelope (ADR-0008); inbox / outbox layout; pluggable transport (local-fs ships, GitHub-PR and URL reserved); `flyway_check` reader | — |
| **S+3** — first sender | `bfaf1db` → `4fded41` | 2026-05-25 | `flyway_tension` — first signal across the boundary; outbox-first delivery; recognized-peer trust gate | Tier 2 — first signal exchange |
| **S+4** — first dialogue | `64b112a` → `2a97330` | 2026-05-25 | `flyway_respond` (tensions only) — full A↔B round-trip with `refs.tensionId` binding the response to its subject | Tier 3 — first signal dialogue |
| **Review hardening** | `2a2ac16` → `d5ad56f` | 2026-05-25 | Three review agents (architecture, TypeScript quality, security) acted on the S+3/S+4 work; ADR-0009 documents the invariant the review surfaced; 12 deferred findings filed as issues | — |

---

## Walkthrough progression

Executable walkthroughs are **evidence, not specification**. Each one runs real code against a real on-disk repo and produces signatures that round-trip through cryptographic verify. Each surfaces gaps that get filed as issues and resolved in the next cycle.

```
Tier 1                          Tier 2                          Tier 3
─────────────                   ─────────────                   ─────────────
mutual recognition       →      first signal exchange    →      first dialogue
2026-05-21 @ 1712232            2026-05-25 @ bfaf1db            2026-05-25 @ 64b112a

A and B independently           A signs a tension envelope;     B reads A's tension,
produce identities,             local-fs transport delivers     verifies it, and signs
each verifies the other,        it into B's inbox; B's          back acknowledge /
each writes a signed            flyway_check independently       dispute / dissolve /
recognition entry.              verifies the signature against   transfer; A verifies
                                B's cached copy of A's key.      and reads the response.

Proves: identity layer.         Proves: send + verify layer.    Proves: full round-trip;
3 gaps surfaced                 3 gaps surfaced                 3 gaps surfaced
(all closed by next SHA)        (filed as issues #17/#18/#19)   (filed as issues #14/#15/#16)
```

| Walkthrough | Kind | Code SHA | Outcome |
| ----------- | ---- | -------- | ------- |
| [2026-05-13 — 3-party retrospective cadence](./walkthroughs/2026-05-13-3party-retrospective-cadence.md) | Narrative | `02e1bfa` | Consent reached after one objection-integration cycle. 8 gaps surfaced. |
| [2026-05-21 — Tier 1 mutual recognition](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) | Executable | `1712232` | Two murmurations mutually recognize each other with verified signatures. 3 gaps surfaced, all resolved in `f9911fd`. |
| [2026-05-25 — Tier 2 first signal exchange](./walkthroughs/2026-05-25-tier2-signal-exchange.md) | Executable | `bfaf1db` | A signed tension envelope crosses A → B; B's `flyway_check` verifies it. 3 gaps filed. |
| [2026-05-25 — Tier 3 first signal dialogue](./walkthroughs/2026-05-25-tier3-signal-dialogue.md) | Executable | `64b112a` | Full A↔B round-trip — tension + acknowledge, both sides hold signed records. 3 gaps filed. |

---

## Architecture invariants — ADR digest

Nine ADRs are accepted; each pins one load-bearing decision.

| # | Title | What it locks in |
| - | ----- | ---------------- |
| [ADR-0001](./adr/0001-project-framing-and-scope.md) | Project framing & scope | flyway is a *protocol* for cross-murmuration coordination, not a runtime |
| [ADR-0002](./adr/0002-typescript-as-implementation-language.md) | TypeScript as implementation language | Strict TS; pure functions in core; I/O at the edges |
| [ADR-0003](./adr/0003-monorepo-layout.md) | pnpm monorepo layout | 5 packages: core, agent, mcp, cli, harness; core is runtime-agnostic |
| [ADR-0004](./adr/0004-agent-skill-as-primary-protocol-interface.md) | Agent skill as the primary protocol interface | [Agent Skills IO](https://agentskills.io) SKILL.md is the canonical surface; MCP/CLI are delivery adapters |
| [ADR-0005](./adr/0005-s3-patterns-as-canonical-protocol-vocabulary.md) | S3 patterns as canonical protocol vocabulary | Sociocracy 3.0 vocabulary (consent, objection, driver, agreement) is the protocol semantics |
| [ADR-0006](./adr/0006-skill-distribution-and-installation.md) | Skill distribution and installation | `flyway skill install` is how a Source plugs flyway into their existing toolchain |
| [ADR-0007](./adr/0007-pluggable-signers-and-anchors.md) | Pluggable signers and on-chain anchoring | `Signer` interface lets a future Cardano-resident signer drop in without touching core |
| [ADR-0008](./adr/0008-signal-transport-convention.md) | Signal transport convention | Signed envelope + inbox/outbox + pluggable transport; local-fs ships, GitHub-PR / URL reserved |
| [ADR-0009](./adr/0009-antecedent-verification-before-signing.md) | **Antecedent verification before signing** | A signer never signs over an unverified antecedent artifact; the verifying key is the recognition-time cached copy |

---

## Cryptographic properties exercised

Where each property is enforced and verified:

| Property | Enforced at | Verified at | Tested by |
| -------- | ----------- | ----------- | --------- |
| **Self-attestation** — every entity statement signed by its own Source | `flywayInit` | `flywayStatus`, `recognizePeer` | `signing.test.ts`, `init.test.ts` |
| **Peer attestation** — recognition signed by the recognizer, binding peer's key fingerprint | `recognizePeer` | `verifyRecognitionEntry`, `flywayStatus` | `recognize.test.ts` |
| **Domain separation** — distinct domain tags per artifact kind; signatures can't be replayed across kinds | `signArtifactInline` | `verifyInlineSignedArtifact` | `signing.test.ts`, all signal tests |
| **Canonicalization** — JCS-style sorted keys, no whitespace, undefined dropped | `canonicalize` | `canonicalize` (deterministic) | `signing.test.ts` (8 cases) |
| **Tamper detection** — any field mutation invalidates the signature | every signer | every verifier | `signing.test.ts` "tampered" suite |
| **Cross-kind replay protection** — kind-specific signal domains (`tension`, `respond`, etc.) | `buildSignedSignal` | `verifySignedSignal` | `signal.test.ts`, `tension.test.ts`, `respond.test.ts` |
| **Antecedent verification** (ADR-0009) — never sign over unverified prior artifact | `createTensionResponse` (core) | n/a — enforced at sign time | `respond.test.ts` ADR-0009 suite |
| **Path-traversal safety** — peer DIDs can't escape the cache subtree | `peerCachePathSegments` | n/a — enforced at parse time | `recognize.test.ts` traversal suite |
| **Recognition-window ordering** — signals must be sent after the peer was recognized | `flywayCheck` | `flywayCheck` | `check.test.ts` |
| **Atomic write** — concurrent signal writers can't race past the differently-signed-envelope guard | `writeSignalFile` (`flag: 'wx'`) | n/a — enforced at write time | — |

---

## What's pending

### Next milestones (planned cadence)

| Milestone | Scope | Unlocks |
| --------- | ----- | ------- |
| **S+5 — flyway_propose** | Flagship sender; proposal staging (driver / requirements / draft / refinement / final); agreement-body schema enforcement | The path to actual cross-murmuration *consent* on engagement agreements |
| **S+6 — proposal responses** | Extend `flyway_respond` with `accept` / `object` / `exit`; `concernsToRecord` first-class field (closes #3 + #15) | Full proposal lifecycle including objection-integration |
| **S+7 — flyway_exit** | Clean unilateral exit from a peer relationship or syndicate | Closes the protocol cycle; exit is a first-class outcome, not a fallback |
| **S+8 — flyway_discover** | URL fetch + DID resolution + flyway directory lookup | First non-local-fs interaction — paves the way for GitHub-PR transport |

### Open issues by theme

19 open issues. Grouped:

**Protocol gaps (`protocol-gap`)** — soundness or correctness holes that don't block current functionality but accumulate risk:

- [#2](https://github.com/murmurations-ai/flyway/issues/2) Tension → proposal "promotion" has no first-class linkage
- [#3](https://github.com/murmurations-ai/flyway/issues/3) `concernsToRecord` not first-class on `flyway_respond`
- [#14](https://github.com/murmurations-ai/flyway/issues/14) `flyway_check` should verify `refs.tensionId` resolves to a real prior signal
- [#16](https://github.com/murmurations-ai/flyway/issues/16) `flyway_check` should flag responses whose `sentAt` precedes the subject's
- [#19](https://github.com/murmurations-ai/flyway/issues/19) `proposedOwner` on tension body has no recognition constraint

**Protocol design (`protocol-design`)** — open design questions:

- [#4](https://github.com/murmurations-ai/flyway/issues/4) Facilitator role is not first-class
- [#5](https://github.com/murmurations-ai/flyway/issues/5) Multi-party consent flow is unspecified (parallel? pairwise? round-robin?)
- [#18](https://github.com/murmurations-ai/flyway/issues/18) Sender-side retry / dedup semantics for signals

**Schema / validation** — concrete fields or validation rules to add:

- [#6](https://github.com/murmurations-ai/flyway/issues/6) Structured requirements field at `stage: requirements`
- [#7](https://github.com/murmurations-ai/flyway/issues/7) Operable trigger / acceptance criteria in agreement schema
- [#8](https://github.com/murmurations-ai/flyway/issues/8) Stage transition validation on `flyway_propose`
- [#11](https://github.com/murmurations-ai/flyway/issues/11) Document `findInboxSignalById` same-id collision behavior
- [#12](https://github.com/murmurations-ai/flyway/issues/12) Whitespace policy on signed body fields
- [#15](https://github.com/murmurations-ai/flyway/issues/15) `concernsToRecord` as first-class field

**Quality of life** — non-blocking but worth doing:

- [#9](https://github.com/murmurations-ai/flyway/issues/9) Restructure `handleRespond` as kind-dispatcher before proposal responses
- [#10](https://github.com/murmurations-ai/flyway/issues/10) Sync vs async filesystem policy decision
- [#13](https://github.com/murmurations-ai/flyway/issues/13) Validate `peerRepoPath` against recognition-time path
- [#17](https://github.com/murmurations-ai/flyway/issues/17) `flyway_status` should surface inbox state
- [#20](https://github.com/murmurations-ai/flyway/issues/20) CLI error messages should end with imperative recovery commands

---

## How to evaluate the work

For a reviewer wanting to understand flyway in ~30 minutes:

1. **Read [`README.md`](../README.md)** — 5 min. The framing, the nine tools, the relationship to `murmurations-harness`.
2. **Skim [`docs/architecture/how-flyway-works.md`](./architecture/how-flyway-works.md)** — 10 min. Concrete sequence diagrams, state machines, contracts. Visual companion at [`how-flyway-works.html`](./architecture/how-flyway-works.html).
3. **Read [Tier 3 walkthrough](./walkthroughs/2026-05-25-tier3-signal-dialogue.md)** — 10 min. The single most informative single-document artifact — shows the protocol carrying a real cross-murmuration governance act end-to-end with verbatim transcript and on-disk evidence.
4. **Spot-check [ADR-0009](./adr/0009-antecedent-verification-before-signing.md)** — 5 min. The most recent architectural decision; gives the flavor of how invariants get captured.

Or run the protocol yourself:

```bash
git clone https://github.com/murmurations-ai/flyway && cd flyway
pnpm install && pnpm -r build
# Then run the Tier 3 walkthrough's reproducible script
```

---

## Repository links

- **Code:** [github.com/murmurations-ai/flyway](https://github.com/murmurations-ai/flyway)
- **Issues:** [github.com/murmurations-ai/flyway/issues](https://github.com/murmurations-ai/flyway/issues)
- **ADRs:** [`docs/adr/`](./adr/) (9 accepted)
- **Walkthroughs:** [`docs/walkthroughs/`](./walkthroughs/) (3 executable, 1 narrative)
- **Architecture reference:** [`docs/architecture/how-flyway-works.md`](./architecture/how-flyway-works.md) + [`.html`](./architecture/how-flyway-works.html)

---

*This snapshot is regenerated as milestones land. Last update: 2026-05-25 at SHA `d5ad56f`.*

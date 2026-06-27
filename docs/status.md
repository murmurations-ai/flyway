---
date: 2026-06-12
protocol-version: 0.1.0
code-sha: 17f9bc1
purpose: project status snapshot for reviewers
audience: external reviewers, peer Sources, and anyone evaluating flyway for adoption
---

# flyway — Status snapshot

> **One-line headline.** All nine protocol tools are wired and exercised end-to-end — the
> protocol surface is complete. Two independent murmurations can discover each other in a
> directory, establish mutual recognition, exchange a tension, run a full S3 proposal-forming
> cycle (driver → requirements → draft → refinement → final), **co-sign an engagement
> agreement** — each side independently materializing a byte-identical
> `flyway/agreements/<id>.yaml` — and **exit cleanly**, with a signed, unilateral exit notice
> that no peer can prevent. Cryptographic verification on both sides throughout; the agreement
> cycle is proven by an executable walkthrough at SHA [`10d7045`](../).

A visual companion lives at [`docs/status.html`](./status.html) — same content, browser-rendered.

---

## At a glance

| | |
| --- | --- |
| **Protocol version** | 0.1.0 |
| **Code SHA** | `17f9bc1` |
| **Tools wired (end-to-end)** | 9 of 9 |
| **Executable walkthroughs** | 6 (Tier 1–6) |
| **ADRs accepted** | 11 |
| **Tests passing** | 398 across 28 test files |
| **Open issues** | 11 (9 closed since the 3-agent review) |
| **Open security findings** | 0 (all high/medium-severity items from the security review are resolved) |

---

## Tool maturity

The protocol surface is **nine typed tools** defined once in `flyway-core` and exposed
through every adapter (agent skill, MCP server, CLI) without rewriting. Status of each:

| # | Tool | Purpose | Status | Demo |
| - | ---- | ------- | ------ | ---- |
| 1 | `flyway_init` | Initialize the murmuration's identity — DID document + signed entity statement + Ed25519 keypair | ✅ **Wired** | [Tier 1](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) |
| 2 | `flyway_status` | Report identity + peers + agreements + signature validity | ✅ **Wired** | [Tier 1](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) |
| 3 | `flyway_discover` | Search a flyway directory for potential peers (pre-trust; verify at recognition). Loads from a local file **or an `https://` URL** (ADR-0010) | ✅ **Wired** | smoke + tests |
| 4 | `flyway_recognize` (+ `unrecognize`) | Verify a peer's identity and produce a signed recognition entry. Resolves the peer locally **or from its `did:web` URL over HTTPS** (ADR-0011) | ✅ **Wired** | [Tier 1](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) · [Tier 6](./walkthroughs/2026-06-26-tier6-remote-recognition.md) |
| 5 | `flyway_tension` | Flag a tension to a recognized peer (S3 *Navigate via Tension*) | ✅ **Wired** | [Tier 2](./walkthroughs/2026-05-25-tier2-signal-exchange.md) |
| 6 | `flyway_propose` | Send a directive, project, or engagement agreement; full S3 staging chain | ✅ **Wired** | [Tier 4](./walkthroughs/2026-06-12-tier4-cosigned-agreement.md) |
| 7 | `flyway_respond` | Respond to a tension (`acknowledge` / `dispute` / `dissolve` / `transfer`) or a proposal (`accept` / `object` / `exit`) | ✅ **Wired** | [Tier 3](./walkthroughs/2026-05-25-tier3-signal-dialogue.md) · [Tier 4](./walkthroughs/2026-06-12-tier4-cosigned-agreement.md) |
| 8 | `flyway_check` | Read incoming flyway signals from peers; verify signatures and flag issues | ✅ **Wired** | [Tier 2](./walkthroughs/2026-05-25-tier2-signal-exchange.md) |
| 9 | `flyway_exit` | Cleanly leave a peer relationship, project, or syndicate — signed, unilateral, always valid | ✅ **Wired** | smoke + tests |

**Status legend:** ✅ wired = runs end-to-end with tests (and, where applicable, an executable walkthrough). All nine tools are wired; what remains are *reserved transports* (remote directory fetch for `flyway_discover`, remote signal transport per ADR-0008) and lifecycle polish — not stubbed tools.

Beyond the nine wire tools, agreement **materialization** (`flyway materialize`) turns an
accepted final-stage agreement proposal into the co-signed
`flyway/agreements/<id>.yaml`. It is a *local act* over records both sides already hold — not
a protocol signal — so it is not counted among the nine. Demonstrated in [Tier 4](./walkthroughs/2026-06-12-tier4-cosigned-agreement.md).

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
| **S+5a** — flagship sender | `682f5c2` → `080aaff` | 2026-05-26 | `flyway_propose` (directive / project / agreement) with the full S3 staging chain and stage-transition validation; `flyway_respond` proposal branch (`accept` / `object` / `exit`) with first-class `concernsToRecord`; ADR-0009 antecedent verification on both senders. Closes #3, #6, #7, #8, #15 | — |
| **S+5b** — co-signed agreements | `10d7045` | 2026-06-12 | Agreement materialization: detached `DOMAIN_AGREEMENT` signatures ride inside the final proposal and the accept, so both sides produce a byte-identical `flyway/agreements/<id>.yaml` from records they already hold. `flyway materialize` CLI verb | Tier 4 — co-signed agreement |
| **S+6** — clean exit | `11c6b0d` | 2026-06-17 | `flyway_exit` — a signed, unilateral exit notice (peer / project / syndicate) that no peer can prevent. Distinct from unrecognition; never mutates a co-signed agreement file. Wired through core, CLI, and MCP | — |
| **S+7** — discovery | `17f9bc1` | 2026-06-17 | `flyway_discover` — the last tool, completing the 9-tool surface. Pre-trust directory search (free-text or exact-DID) over a published `FlywayDirectory`; v0.1 reads a local directory file, remote fetch reserved | — |
| **S+8** — agreement provenance | `896b965` | 2026-06-26 | `originTensionId` (Issue #2): the verified tension id propagates through the staging chain and is auto-stamped onto the co-signed agreement, under both signatures; a forged/mismatched link is refused. Closes #2 | [Tier 5](./walkthroughs/2026-06-17-tier5-staging-chain.md) (gap note flipped to resolved) |
| **S+9** — remote directory fetch | `db90614`+ | 2026-06-26 | v0.2a, part 1: `flyway_discover` loads a directory over `https://` (ADR-0010) — flyway's first non-local-fs operation. HTTPS-only, SSRF-guarded, size/timeout-bounded, fully injectable for tests | — |
| **S+10** — transport seam | `58ddf69` | 2026-06-26 | v0.2a, part 2: the `SignalTransport` interface + `sendSignal` (outbox-first) + `localFsTransport` default. All four senders deliver *through* a transport, so github-pr / url-webhook drop in without touching them. Behavior-preserving | — |
| **S+11** — recognize at a distance | _this branch_ | 2026-06-26 | A peer is resolved from its `did:web` URL over HTTPS and recognized with no shared filesystem (ADR-0011). Shared `http.ts` fetch helper; `resolvePeerIdentity` is pre-trust, `recognizePeer` still verifies. Completes the discover→recognize remote flow | [Tier 6](./walkthroughs/2026-06-26-tier6-remote-recognition.md) |

---

## Walkthrough progression

Executable walkthroughs are **evidence, not specification**. Each one runs real code against a real on-disk repo and produces signatures that round-trip through cryptographic verify. Each surfaces gaps that get filed as issues and resolved in the next cycle.

```
Tier 1                Tier 2                Tier 3                Tier 4
───────────────       ───────────────       ───────────────       ───────────────
mutual recognition →  first signal     →    first dialogue   →    co-signed agreement
2026-05-21 @ 1712232  exchange              2026-05-25 @ 64b112a  2026-06-12 @ 10d7045
                      2026-05-25 @ bfaf1db

A and B independently  A signs a tension     B reads A's tension,  A proposes a final
produce identities,    envelope; local-fs    verifies it, and      agreement; B accepts,
each verifies the      transport delivers    signs back            co-signing it; each
other, each writes a   it into B's inbox;    acknowledge /         side independently
signed recognition     B's flyway_check      dispute / dissolve /  materializes a
entry.                 independently         transfer; A verifies  byte-identical
                       verifies the          and reads the         agreements/<id>.yaml.
                       signature.            response.

Proves: identity.      Proves: send+verify.  Proves: round-trip.   Proves: co-signing;
3 gaps surfaced        3 gaps surfaced       3 gaps surfaced       byte-identical files.
(closed by next SHA)   (issues #17/#18/#19)  (issues #14/#15/#16)  2 gaps surfaced
```

| Walkthrough | Kind | Code SHA | Outcome |
| ----------- | ---- | -------- | ------- |
| [2026-05-13 — 3-party retrospective cadence](./walkthroughs/2026-05-13-3party-retrospective-cadence.md) | Narrative | `02e1bfa` | Consent reached after one objection-integration cycle. 8 gaps surfaced. |
| [2026-05-21 — Tier 1 mutual recognition](./walkthroughs/2026-05-21-tier1-mutual-recognition.md) | Executable | `1712232` | Two murmurations mutually recognize each other with verified signatures. 3 gaps surfaced, all resolved in `f9911fd`. |
| [2026-05-25 — Tier 2 first signal exchange](./walkthroughs/2026-05-25-tier2-signal-exchange.md) | Executable | `bfaf1db` | A signed tension envelope crosses A → B; B's `flyway_check` verifies it. 3 gaps filed. |
| [2026-05-25 — Tier 3 first signal dialogue](./walkthroughs/2026-05-25-tier3-signal-dialogue.md) | Executable | `64b112a` | Full A↔B round-trip — tension + acknowledge, both sides hold signed records. 3 gaps filed. |
| [2026-06-12 — Tier 4 co-signed agreement](./walkthroughs/2026-06-12-tier4-cosigned-agreement.md) | Executable | `10d7045` | A proposes a final agreement, B co-signs by accepting; both materialize a byte-identical agreement file. 2 gaps surfaced. |
| [2026-06-17 — Tier 5 staging chain](./walkthroughs/2026-06-17-tier5-staging-chain.md) | Executable | `4c894b6` | The full driver→final chain; B's objection at draft is integrated in a refinement and lands in the co-signed agreement. 2 gaps (G8/#2, G10). |
| [2026-06-26 — Tier 6 remote recognition](./walkthroughs/2026-06-26-tier6-remote-recognition.md) | Executable (test-backed) | _this branch_ | A peer is discovered from a remote HTTPS directory and recognized from its `did:web` URL — no shared filesystem. Closes the "recognition at a distance" gap Tier 1 left open. |

---

## Architecture invariants — ADR digest

Eleven ADRs are accepted; each pins one load-bearing decision.

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
| [ADR-0010](./adr/0010-remote-directory-fetch.md) | **Remote directory fetch (HTTPS)** | `flyway_discover` may fetch a directory over `https://`; HTTPS-only, SSRF-guarded, size/timeout-bounded — flyway's first non-local-fs operation |
| [ADR-0011](./adr/0011-did-web-resolution-convention.md) | **did:web resolution convention** | `did:web:github.com:owner:repo` resolves to raw.githubusercontent identity artifacts; reuses the ADR-0010 fetch hardening; verified at recognition |

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
| **Antecedent verification** (ADR-0009) — never sign over unverified prior artifact | `createTensionResponse` / `createProposalResponse` / `createProposal` / `materializeAgreement` | n/a — enforced at sign / materialize time | `respond.test.ts`, `propose.test.ts`, `materialize.test.ts` ADR-0009 suites |
| **Co-signature byte-identity** — both parties sign the same target; both materialize identical bytes | `signAgreement` (detached `DOMAIN_AGREEMENT`) | `materializeAgreement` (SHA-256 match) | `materialize.test.ts` byte-identity + standalone-verify suites |
| **Agreement provenance** (Issue #2) — `originTensionId` propagated through the chain and stamped under both co-signatures; a forged or mismatched link is refused | `createProposal` (`validateAgreementProvenance` + auto-stamp at `final`) | n/a — enforced at sign time; carried byte-identically into the file | `propose.test.ts` provenance suite, `materialize.test.ts` originTensionId-under-signature test |
| **Path-traversal safety** — peer DIDs can't escape the cache subtree | `peerCachePathSegments` | n/a — enforced at parse time | `recognize.test.ts` traversal suite |
| **Recognition-window ordering** — signals must be sent after the peer was recognized | `flywayCheck` | `flywayCheck` | `check.test.ts` |
| **Atomic write** — concurrent signal writers can't race past the differently-signed-envelope guard | `writeSignalFile` (`flag: 'wx'`) | n/a — enforced at write time | — |

---

## What's pending

### Next milestones (planned cadence)

All nine tools have landed (the surface is complete through S+7 / `flyway_discover`), and the
full proposal-forming chain is now proven end-to-end by the [Tier 5 walkthrough](./walkthroughs/2026-06-17-tier5-staging-chain.md).
What's left is reach and depth — not new tools:

| Milestone | Scope | Unlocks |
| --------- | ----- | ------- |
| **Remote transports (v0.2)** | [Specified](./architecture/remote-transports-v0.2.md), phased v0.2a/b/c. **v0.2a complete** (HTTPS directory fetch + `SignalTransport` seam) and **recognize-at-a-distance** shipped (ADR-0011, Tier 6). Remaining: **v0.2b** GitHub-PR signal transport, **v0.2c** URL-webhook | Peers at a distance — the first non-local-fs operations |
| **Exit-aware status** | `flyway_status` / `flyway_check` interpret exit records — surface a relationship or agreement as closed | Makes the exit lifecycle legible without re-reading raw signals |
| ~~Agreement provenance (Issue #2 / G8)~~ ✅ **done** | `originTensionId` propagated through the staging chain and auto-stamped onto the co-signed agreement; refused if it disagrees with the verified chain tension | Machine-followable audit trail — agreement → tension by reference, not five human hops |

### Open issues by theme

11 open issues (9 closed: #3, #6, #7, #8, #9, #14, #15, **#2**, and one historical). Grouped:

**Protocol gaps (`protocol-gap`)** — soundness or correctness holes that don't block current functionality but accumulate risk:

- [#16](https://github.com/murmurations-ai/flyway/issues/16) `flyway_check` should flag responses whose `sentAt` precedes the subject's
- [#19](https://github.com/murmurations-ai/flyway/issues/19) Constrain tension `proposedOwner` to a recognized peer

**Protocol design (`protocol-design`)** — open design questions:

- [#4](https://github.com/murmurations-ai/flyway/issues/4) Facilitator role is not first-class
- [#5](https://github.com/murmurations-ai/flyway/issues/5) Multi-party consent flow is unspecified (parallel? pairwise? round-robin?)
- [#18](https://github.com/murmurations-ai/flyway/issues/18) Sender-side retry / dedup semantics for signals

**Schema / validation** — concrete fields or validation rules to add:

- [#11](https://github.com/murmurations-ai/flyway/issues/11) Document `findInboxSignalById` same-id collision behavior
- [#12](https://github.com/murmurations-ai/flyway/issues/12) Whitespace policy on signed body fields

**Quality of life** — non-blocking but worth doing:

- [#10](https://github.com/murmurations-ai/flyway/issues/10) Sync vs async filesystem policy decision
- [#13](https://github.com/murmurations-ai/flyway/issues/13) Validate `peerRepoPath` against recognition-time path
- [#17](https://github.com/murmurations-ai/flyway/issues/17) `flyway_status` should surface inbox state
- [#20](https://github.com/murmurations-ai/flyway/issues/20) CLI error messages should end with imperative recovery commands

---

## How to evaluate the work

For a reviewer wanting to understand flyway in ~30 minutes:

1. **Read [`README.md`](../README.md)** — 5 min. The framing, the nine tools, the relationship to `murmurations-harness`.
2. **Skim [`docs/architecture/how-flyway-works.md`](./architecture/how-flyway-works.md)** — 10 min. Concrete sequence diagrams, state machines, contracts. Visual companion at [`how-flyway-works.html`](./architecture/how-flyway-works.html).
3. **Read [Tier 4 walkthrough](./walkthroughs/2026-06-12-tier4-cosigned-agreement.md)** — 10 min. The single most informative single-document artifact — shows the protocol carrying a real cross-murmuration governance act all the way to a co-signed agreement, with verbatim transcript, on-disk evidence, and a matching SHA-256 proving byte-identity. (The [Tier 3 walkthrough](./walkthroughs/2026-05-25-tier3-signal-dialogue.md) covers the tension dialogue that precedes it.)
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
- **Walkthroughs:** [`docs/walkthroughs/`](./walkthroughs/) (4 executable, 1 narrative)
- **Architecture reference:** [`docs/architecture/how-flyway-works.md`](./architecture/how-flyway-works.md) + [`.html`](./architecture/how-flyway-works.html)

---

*This snapshot is regenerated as milestones land. Last update: 2026-06-26 — surface complete (9 of 9); Issue #2 closed; **v0.2a complete** plus **recognize-at-a-distance** (ADR-0010/0011): a peer can be discovered and recognized over HTTPS with no shared filesystem (Tier 6). Next: v0.2b github-pr transport.*

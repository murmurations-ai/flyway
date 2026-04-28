# Harness Primitives Audit for flyway Extension Points

**Status:** Research input, not a decision document
**Audience:** flyway architecture working group (synthesis paper, strand 3 of 3)
**Date:** 2026-04-27

## 0. Framing

flyway needs to integrate with `murmurations-ai/murmurations-harness` without modifying it. The harness's ship bar — "second murmuration installs it" — must remain inviolate. This audit inventories existing harness primitives and identifies the seams where flyway can extend, wrap, or compose without forking.

The findings below are based on direct examination of the harness codebase (`/Users/nnishigaya/Code/murmurations-harness`) and its accepted ADRs (0001–0033 as of 2026-04-27, post PR #228 merge).

## 1. Inventory

### 1.1 Identity (`packages/core/src/identity/`)

**What it does.** Loads each agent's identity from disk: murmuration `soul.md`, agent `soul.md`, agent `role.md` frontmatter (Zod-validated), group context. Composes them into an `IdentityChain` which is passed to executors as `AgentSpawnContext`.

**Where it lives.** `packages/core/src/identity/index.ts`. Branded types `AgentId`, `GroupId` in `execution/branded.ts`.

**Extension point.** The `IdentityChain` is composed per-wake; flyway could inject *peer-murmuration* identity context (e.g., "this agent is acting on behalf of a federated request from murmuration X") by augmenting the chain before the executor reads it. No harness modification needed — flyway can compose at the wiring layer.

**Gap.** No notion of an external murmuration identity. Identity is local-only today. flyway needs to define *what counts as a murmuration's stable identifier* (DID, repo URL, pubkey) and add it to the identity surface.

### 1.2 Signals (`packages/signals/src/`)

**What it does.** Per-wake signal aggregation. Sources: GitHub issues (filtered by `signals.github_scopes` per role.md), private notes (filesystem), inbox messages (filesystem), and an optional `CollaborationProvider.collectSignals()` path for non-GitHub backends. Output: `SignalBundle { signals, actionItems, warnings }`.

**Where it lives.** `packages/signals/src/index.ts`. Key interface: `DefaultSignalAggregator`. Trust levels: `trusted | semi-trusted | untrusted`.

**Extension point.** The `Signal` type is an open discriminated union (`kind: "github-issue" | "private-note" | "inbox-message" | "custom"`). flyway can introduce new signal kinds (e.g., `kind: "peer-directive"`, `kind: "federation-event"`) and existing aggregator code will route them through unchanged — agents that don't know what to do with them can ignore them.

The `CollaborationProvider.collectSignals()` path (per ADR-0021) is the cleanest seam: flyway can implement a `FederationCollaborationProvider` that emits signals from peer murmuration repos, and the daemon wires it in alongside the GitHub source.

**Gap.** Today's aggregator runs sources serially with no cross-source deduplication. Federation signals that mirror a local issue (e.g., "directive #571 in this repo, also visible as a federation event") could appear twice. Mitigation is signal-side, not aggregator-side.

### 1.3 Directives

**What it does.** A directive is a GitHub issue with the `source-directive` label. Per the daemon comment at `packages/core/src/daemon/index.ts:702`: "the signal aggregator surfaces them via listIssues — no daemon-side injection needed." Directives have scope labels (`scope:agent:<id>`, `scope:group:<id>`, `scope:all`) or assignment labels (`assigned:<agent-id>`).

**Where it lives.** `packages/cli/src/directive.ts` (CLI subcommand), `packages/core/src/daemon/command-executor.ts:#handleDirectiveList` (REPL `:directive list`).

**Extension point.** Directives are just labeled issues — flyway can introduce `flyway-directive` (or similar) as a separate label class for cross-murmuration asks. Or: a flyway directive can be a *pair* of mirrored `source-directive` issues, one in each participating murmuration's repo, linked by a shared correlation ID in body frontmatter.

**Gap.** No protocol for a directive to span repos. A flyway-directive's lifecycle (issued → accepted → resolved → closed) needs primitives the harness doesn't have today.

### 1.4 Governance plugin interface (`packages/core/src/governance/`)

**What it does.** Model-agnostic governance contract. The harness defines:
- `GovernancePlugin` — interface for a governance model
- `GovernanceTerminology` — display strings ("circle" vs "department", "consent" vs "vote")
- `GovernanceStateGraph` — states + transitions (open strings, plugin-defined)
- `GovernanceMeetingPrompts` — member/facilitator prompt templates + position parser
- `GovernanceStateStore` — state machine + persistence
- `GovernanceGitHubSync` — sync state to/from GitHub issues

**Where it lives.** `packages/core/src/governance/`. Plugins are loaded via `harness.yaml`'s `governance.plugin` field.

**Extension point.** The plugin interface is the load-bearing seam for flyway. A `FederationGovernancePlugin` could:
- Define states like `federation:proposed`, `federation:peer-consenting`, `federation:ratified`
- Provide prompts for inter-murmuration decision rounds
- Map federation events into governance state transitions
- Optionally compose with each murmuration's existing governance plugin (e.g., S3 internally + flyway federation externally)

**Gap.** No plugin composition today. Each murmuration has one governance plugin. Either flyway is a *replacement* plugin (which loses S3 internally) or the plugin interface needs a composition primitive (a small ADR addition: "plugin can declare delegated sub-plugins").

### 1.5 The S3 governance plugin

**What it does.** Concrete governance plugin that models S3 (Sociocracy 3.0). State graph: tension → proposal → consent round → ratified | rejected | adapted. Object lifecycle: tension is filed (issue), maps to proposal (issue with proposal label), runs consent round (comments collect positions), facilitator declares outcome (state transition).

**Where it lives.** Bundled with the CLI; resolved at boot. Bundling convention is documented at `docs/adr/UPCOMING.md § A1` (slightly inconsistent with CLAUDE.md's "no governance-specific content in `packages/`" rule).

**Extension point.** flyway can use the S3 plugin as a reference for what a governance plugin looks like, and as a model for inter-murmuration consent rounds (S3's consent semantics generalize naturally to federation: "no objection from any participating Source" is a clean stop rule).

**Gap.** S3 plugin's state machine is single-circle. Cross-circle work in S3 (delegate circles, double-linking) isn't modeled in the plugin today. flyway's federation governance could draw on the same patterns.

### 1.6 Group meetings (`packages/core/src/groups/`)

**What it does.** `runGroupWake()` runs a group meeting: collects member positions, runs facilitator turn, parses structured `actions` JSON from facilitator output, executes actions against GitHub. Three meeting kinds: `operational`, `governance`, `retrospective`.

**Where it lives.** `packages/core/src/groups/index.ts`. `MeetingAction` and `parseMeetingActions()` define the action schema.

**Extension point.** A group meeting is a primitive that already coordinates multiple agents. flyway's cross-murmuration meeting can be implemented as a *pair of synchronized group meetings*, one in each murmuration, with their members exchanging positions through a flyway-side bridge (or through mirrored GitHub issues).

**Gap.** Group meetings assume members are local agents. Flyway needs the concept of a "federation meeting" where members are *delegate agents from peer murmurations*.

### 1.7 CollaborationProvider (ADR-0021)

**What it does.** Abstracts where collaborative state lives. Two implementations today: `GitHubCollaborationProvider` (the primary) and `LocalCollaborationProvider` (for offline / hello-world). Interface: `listItems()`, `createItem()`, `updateItem()`, `closeItem()`, `addLabel()`, `removeLabel()`, `addComment()`, plus `collectSignals()` for the signal aggregator's CollaborationProvider source.

**Where it lives.** `packages/core/src/collaboration/` (interface), `packages/cli/src/collaboration-factory.ts` (wiring).

**Extension point.** **This is flyway's primary integration seam.** flyway can implement a `FederationCollaborationProvider` that:
- Wraps multiple per-repo providers (one per peer murmuration)
- Routes reads/writes by repo coordinate
- Emits federation signals via `collectSignals()`
- Handles cross-repo correlation (e.g., a federation directive's mirrored issues)

The daemon's existing wiring already passes the CollaborationProvider into the signal aggregator, governance sync, command executor, etc. — flyway gets to participate in all of those by implementing this one interface.

**Gap.** The interface today assumes a single repo per provider. A federation provider with multiple repos either needs to extend the interface (adding `repo` parameter to operations) or wrap multiple per-repo providers internally. Both are reasonable; the second is simpler and probably right.

### 1.8 GitHub mutations (ADR-0017)

**What it does.** Write-scope-enforced GitHub mutations: `createIssueComment`, `createCommitOnBranch`, `createIssue`, `closeIssue`, `addLabel`, `removeLabel`. Scopes are declared in agent role.md `github.write_scopes` and enforced at the client layer.

**Where it lives.** `packages/github/src/mutations.ts`. Scope enforcement uses `minimatch`-style globs.

**Extension point.** flyway's federation actions either compose existing mutations (e.g., a federation directive *is* two `createIssue` calls into different repos) or introduce a higher-level federation primitive that the harness doesn't need to know about.

**Gap.** Write scopes today are per-agent-per-repo. Federation work introduces "this agent can write to peer murmuration X's repo iff that murmuration has a federation agreement with us." That's a derived rule — flyway can compute it and inject the right write scopes at boot, but the harness's enforcement logic doesn't need to change.

### 1.9 The Spirit (ADR-0024)

**What it does.** Operator-facing companion LLM. Skills system. Phase 1 MVP. Currently focused on operator-side helpers (init, doctor, REPL skills).

**Where it lives.** `packages/cli/src/spirit/` (rough; verify path).

**Extension point.** A Spirit skill can be a flyway-side helper — e.g., `:flyway peers` to list recognized peer murmurations, `:flyway propose <peer> <topic>` to file a cross-murmuration directive. Skills compose with existing harness UX without needing protocol changes.

**Gap.** Spirit is operator-facing, not agent-facing. Flyway's protocol work is agent-facing (agents acting in cross-murmuration meetings). The Spirit is the right place for operator-side flyway tooling but not for the protocol itself.

### 1.10 Extensions (ADR-0023)

**What it does.** Extension system for plugins. Extensions can register tools, governance plugins, identity readers, etc. OpenClaw-compatible. Per-agent declarations + runtime gating (so an agent can decline a tool it doesn't trust).

**Where it lives.** `packages/core/src/extensions/`.

**Extension point.** flyway *as an extension* is a plausible packaging: an operator installs `@murmurations-ai/flyway` as an extension of the harness, and the extension registers tools, governance plugins, signal sources, and CLI commands. This is the cleanest packaging and avoids modifying the harness core.

**Gap.** None obvious — the extension system was designed for exactly this kind of thing.

### 1.11 Cost / budget (`packages/core/src/cost/`)

**What it does.** Per-wake cost record (`WakeCostRecord`): LLM token counts, cost in micros, GitHub API calls, custom cost dimensions. Budget enforcement: `max_cost_micros`, `max_github_api_calls` per role.md, with `on_breach` policy (warn / abort).

**Where it lives.** `packages/core/src/cost/`.

**Extension point.** Cross-murmuration work has cost (LLM calls in one murmuration, API calls into peer's repo). The cost dimensions are extensible — flyway can add `federation:peer-api-calls` or similar to attribute cost to peer murmurations.

**Gap.** No notion of cost-sharing or settlement between murmurations. If A's agent does work that benefits B, who pays the LLM bill? This is a governance question, not a tech question, but the cost record needs to *make it visible*. Today: trivially extensible via custom cost dimensions.

### 1.12 Wake actions (`packages/core/src/execution/`)

**What it does.** Structured actions emitted by an agent's wake output. Validated via `validateWake()` and `parseWakeActions()`. Action kinds include `comment`, `label`, `create-issue`, `close-issue`, `commit`, etc. The agent emits actions as JSON; the harness executes them post-wake.

**Where it lives.** `packages/core/src/execution/`.

**Extension point.** Action kinds are open — flyway can add `propose-federation-directive`, `accept-peer-meeting`, etc. Existing parsing tolerates unknown kinds (warns + skips). The harness's post-wake executor can route unknown kinds to a flyway-registered handler.

**Gap.** Today the action executor is a hard-coded switch on action kind. flyway-side actions either need a handler-registration mechanism (small harness change) or flyway handles them via a separate post-wake hook (which the daemon already has — `onWakeActions` callback).

### 1.13 Harness directory layout (ADR-0026)

**What it does.** Canonical layout for an operator's murmuration repo: `murmuration/soul.md` + `murmuration/harness.yaml` + `agents/<id>/role.md` + `agents/<id>/soul.md` + `governance/` + `runs/` + `.murmuration/` (runtime, gitignored).

**Where it lives.** Documented in `docs/adr/0026-harness-directory-layout.md`. Loaded by `IdentityLoader` and `HarnessConfig`.

**Extension point.** flyway can introduce its own directory under the operator's repo:
- `flyway/peers.yaml` — list of recognized peer murmurations
- `flyway/agreements/` — per-peer agreement metadata, governance protocol negotiated, schema versions
- `flyway/cache/` — cached views of peer state (gitignored or committed depending on operator preference)

**Gap.** None — operators can already add directories. flyway just needs to define its conventions.

### 1.14 Configuration (`harness.yaml`, role.md frontmatter)

**What it does.** `harness.yaml` declares murmuration-wide config: governance plugin, collaboration provider, logging, products. Role.md frontmatter declares per-agent config: signals, write scopes, budget, secrets, plugins, MCP tools.

**Where it lives.** `packages/cli/src/config.ts`, role.md schema in `packages/core/src/identity/`.

**Extension point.** Both files are extensible (additional top-level keys are accepted). flyway can introduce `harness.yaml § flyway:` for federation-wide config and `role.md § flyway:` for per-agent federation participation.

**Gap.** None obvious.

## 2. Synthesis

### 2.1 What does Murmuration A look like to Murmuration B?

**Today: nothing.** The harness has no concept of an external peer murmuration. Every code path assumes "the murmuration" is the current operator's installation.

**Going forward (flyway):** Murmuration A is, from B's perspective, a *resolvable identifier* (URL or DID), a *repo* (GitHub coordinate or DID-resolved location), an *entity statement* (signed metadata: governance plugin, recognized peers, schemas spoken), and a set of *agreements* (per-pair: what protocols apply, what trust level, what schemas).

This shape can be expressed as a config artifact (`flyway/peers.yaml`) and a runtime object (loaded at boot, refreshed periodically). No code-level "peer" type needs to ship with the harness — flyway introduces it.

### 2.2 Where does flyway sit architecturally?

Three plausible options, with concrete implications:

**Option 1: Harness extension (ADR-0023 path).**
- *What it requires:* flyway implements the harness's extension API. Operator installs `@murmurations-ai/flyway` as an extension.
- *What it gives:* Federation tools, signal sources, CLI commands all register via existing extension API. No harness modification.
- *What it precludes:* Tight architectural coupling. flyway is just one of many possible extensions, not a privileged collaborator.
- *Verdict:* Plausible but probably too lightweight. Federation touches identity, signals, governance, CollaborationProvider — too many integration points to express as an extension.

**Option 2: Separate daemon/process consuming the harness's CollaborationProvider.**
- *What it requires:* flyway runs as its own process. It speaks to the harness over a defined interface (probably HTTP/socket or just by reading/writing the same GitHub repo).
- *What it gives:* Clean separation. flyway has its own lifecycle, can be restarted independently.
- *What it precludes:* Tight integration with the agent wake loop. Federation signals can't appear in wake bundles unless flyway pre-writes them as GitHub issues (which is fine but adds latency).
- *Verdict:* Plausible for v2+ when flyway is mature. Probably too heavy for v0.1.

**Option 3: Parallel package set under `@murmurations-ai/*`, installed alongside the harness.**
- *What it requires:* `@murmurations-ai/flyway-core`, `@murmurations-ai/flyway-collaboration-provider`, `@murmurations-ai/flyway-governance-plugin`. Each is a regular npm package the harness can compose with.
- *What it gives:* Operators wire flyway into their `harness.yaml` (`collaboration.provider: flyway`, `governance.plugin: flyway-s3`). The harness itself is unmodified. flyway gets first-class participation in every harness layer because it implements the harness's published interfaces.
- *What it precludes:* Operators who don't install flyway packages don't get federation. That's correct.
- *Verdict:* **This is the right shape.** It uses the harness's existing extension seams (CollaborationProvider, GovernancePlugin, signal sources, Spirit skills, extension tools) without inventing new harness-internal concepts.

### 2.3 ADRs the harness would need

For Option 3 to work cleanly, the harness might need (small) additions:

- **A new ADR on plugin composition.** Either via a `governance.plugins[]` array (multiple plugins, ordered) or via a "wrapping" pattern where one plugin can delegate to another for sub-decisions. Without this, flyway federation governance has to *replace* S3 internally instead of *complement* it.
- **A small clarification on CollaborationProvider's repo dimension.** Today the interface implicitly assumes one repo. A `FederationCollaborationProvider` either takes a `repo` parameter on each operation (interface change) or wraps multiple single-repo providers (no change, but each call needs explicit repo selection). The wrapping approach is fine; document it.
- **A `signal.kind` registration mechanism.** Today new signal kinds are open via the discriminated union, but agents have no way to know which kinds they should expect. flyway should register its kinds (`peer-directive`, `federation-event`) so docs and tooling can enumerate them.
- **An action handler registration mechanism.** Today `parseWakeActions` tolerates unknown kinds (warns + skips). flyway needs a way to register handlers for its own kinds. The daemon's `onWakeActions` callback may already be sufficient — verify.

None of these are blocking; v0.1 of flyway can land before any of them, and they're additive (no breaking change).

### 2.4 Concrete primitives flyway can compose

Given the existing harness primitives, here are five flyway primitives expressible without harness changes:

1. **Cross-murmuration directive (mirrored issues).**
   - A flyway-side process opens an issue in murmuration A's repo with `source-directive` + `flyway-directive` + correlation-ID labels, and a paired issue in B's repo with the same correlation-ID. Each side's agents see it as a normal directive in their signal bundle. Closing one closes the other (via flyway's webhook or polling).

2. **Federation entity statement.**
   - Each murmuration commits `flyway/entity-statement.json` to its repo, signed by the murmuration's key. Other murmurations fetch it via raw GitHub URL. Adoption: zero harness change, all existing GitHub primitives.

3. **Cross-murmuration consent round.**
   - A federation governance plugin runs an S3-style consent round where members are *delegate agents* from each participating murmuration. Implementation: flyway opens a coordinated meeting issue in each repo, agents post positions in their home repo, flyway aggregates positions across repos, facilitator (one chosen at the start of the round) declares outcome.

4. **Federation signal: peer action item.**
   - Murmuration B labels an issue with `flyway-share:<peer-id>`. Murmuration A's flyway-side signal source picks it up via a CollaborationProvider extension, surfaces it as a `kind: "peer-action-item"` signal in A's agents' wake bundles. A's agents can act on it (creating a corresponding local issue or commenting on the peer's issue, subject to write-scope agreements).

5. **Federation agreement: pairwise protocol negotiation.**
   - Two murmurations agree on a set of schemas, protocols, and trust levels via PRs against each other's `flyway/agreements/<peer>.yaml`. Each side reviews and merges before the agreement takes effect. The agreement is just a Git artifact — flyway-side runtime reads it to gate federation actions.

### 2.5 What's the minimum-viable flyway?

For an MVP that demonstrates federation between two murmurations:

1. **Identity:** `did:web` resolved from `<murmuration-repo>/.well-known/did.json`. Each murmuration controls its DID document.
2. **Entity statement:** signed JSON in `flyway/entity-statement.json` listing DID, public key, recognized peers, schema versions spoken.
3. **Pairwise agreement:** PR-based negotiation, merged into both repos as `flyway/agreements/<peer>.yaml`.
4. **One primitive:** mirrored cross-murmuration directives (Primitive 1 above), demonstrated end-to-end with two murmurations.
5. **One Spirit skill:** `:flyway peers` listing recognized peer murmurations.
6. **One CollaborationProvider:** `FederationCollaborationProvider` that wraps the local GitHub provider + reads peer repos for federation signals.

Everything else — federation consent rounds, schemas registry, multi-peer meetings, conflict resolution between Sources — comes after the MVP shows the basic shape works.

## 3. Recommendations

1. **Package flyway as Option 3** (parallel package set under `@murmurations-ai/*`). Compose with the harness via existing CollaborationProvider, GovernancePlugin, Spirit skills, and extension tool interfaces.

2. **Don't fork the harness, don't add a hard dependency on flyway from the harness.** The harness must continue to ship as a single-murmuration runtime.

3. **File 3-4 small harness ADRs** for plugin composition, CollaborationProvider repo dimension, signal kind registration, and action handler registration. None are blocking; all are additive.

4. **Build the MVP around mirrored cross-murmuration directives.** That's the single primitive that exercises identity + signals + write scopes + agreements end-to-end.

5. **Treat the harness's existing primitives as the federation contract.** Two murmurations interoperate iff they speak compatible versions of the same `@murmurations-ai/*` packages and the same flyway schemas. Schema versions in entity statements make this checkable.

## 4. References

- harness `CLAUDE.md` — scope cap (no multi-murmuration coordination in v0.1)
- harness `docs/adr/0017-github-mutations.md` — write-scope enforcement
- harness `docs/adr/0021-collaboration-provider-abstraction.md` — primary integration seam for flyway
- harness `docs/adr/0023-extension-system.md` — alternative packaging path (rejected for flyway in §2.2)
- harness `docs/adr/0024-spirit-of-the-murmuration.md` — operator companion
- harness `docs/adr/0026-harness-directory-layout.md` — operator repo conventions
- harness `docs/adr/0033-github-actions-for-ci.md` — CI/release pipeline (relevant when flyway publishes to npm)
- emergent-praxis `agents/*/role.md` — example signal scopes and write scopes patterns flyway can follow

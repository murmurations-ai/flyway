![Three independent starling murmurations — a flowing wave, a curling spiral, and a long ribbon — sharing the same migration corridor at golden hour, with faint threads of light suggesting mutual awareness across the open sky.](./assets/banner.jpg)

# flyway

### One open corridor, no controller.

**A runtime-agnostic protocol for collaboration between independent AI-agent murmurations.**

flyway is the shared airspace that lets sovereign, autonomous murmurations **discover** one another, **recognize** identity cryptographically, **exchange** governance signals, **co-sign** byte-identical agreements, and **exit clean** — without surrendering authority to a central controller.

**🌅 [Live site](https://murmurations-ai.github.io/flyway/) · [Presentation](https://murmurations-ai.github.io/flyway/presentation.html) · [Live demo](https://murmurations-ai.github.io/flyway/demo.html) · [Status dashboard](https://murmurations-ai.github.io/flyway/status.html)**

> **Status (protocol v0.1.0).** All **nine tools run end-to-end**. Two independent murmurations can discover each other, establish mutual recognition, exchange a tension, run a full S3 proposal-forming cycle (driver → requirements → draft → refinement → final), **co-sign an engagement agreement** (each side independently materializing a byte-identical `flyway/agreements/<id>.yaml`), and **exit cleanly** — with cryptographic verification on both sides throughout. **449 tests** across 30 files · **13 ADRs** accepted · **8 executable walkthroughs** (Tier 1–8). See [`docs/status.md`](./docs/status.md) for the full dashboard.

---

## Quickstart

flyway is one typed core exposed three ways — an **agent skill**, an **MCP server**, and a **CLI**. Pick the path that fits who's driving.

### 🧑 For a human

```bash
git clone https://github.com/murmurations-ai/flyway && cd flyway
pnpm install
pnpm --filter '!*harness' -r build

# mint this murmuration's cryptographic identity (DID + signed entity statement + Ed25519 keypair)
node packages/cli/dist/bin/flyway.js init \
  --repo-url https://github.com/you/your-repo --source-name "You"

# see what you've got
node packages/cli/dist/bin/flyway.js status
```

From there: `recognize` a peer, flag a `tension`, `propose` an agreement, `check` your inbox, `exit` when done. Run `flyway <command> --help` for options, or read the [live demo](https://murmurations-ai.github.io/flyway/demo.html) for the full loop.

### 🤖 For an agent (or a Source pointing their murmuration at flyway)

A murmuration doesn't need a human at the keyboard. Point your agent at this repo and it can learn and speak the protocol three ways:

**1. Install the skill** — the [Agent Skills IO](https://agentskills.io) `SKILL.md` teaches the nine tools and works across Claude Code, Cursor, VS Code Copilot, Gemini CLI, OpenAI Codex, Goose, Roo Code, and 30+ agent environments:

```bash
# writes the flyway SKILL.md into your agent's skills directory
node packages/cli/dist/bin/flyway.js skill install
node packages/cli/dist/bin/flyway.js skill list      # what's installed, and whether it drifted
```

**2. Or run the MCP server** — exposes all nine tools over stdio to any MCP-capable client:

```bash
node packages/mcp/dist/bin/flyway-mcp.js
# then register it in your MCP client's server config
```

**3. Or call the CLI directly** — every tool is a subcommand with `--json` output where it matters (`status --json`, `check --json`), so an agent can drive it and parse results.

**What to read to learn the protocol.** The canonical specification *is* the code — there is no separate spec at v0.1:

- **Tool schemas + protocol instructions:** [`packages/core/src`](./packages/core/src) — the nine tools defined once, in JSON Schema, with the instructions every adapter serves.
- **The skill:** the generated `flyway/SKILL.md` (from [`packages/agent`](./packages/agent)) — a self-contained protocol primer written for agents.
- **How it works:** [`docs/architecture/how-flyway-works.md`](./docs/architecture/how-flyway-works.md) — sequence diagrams, state machines, the signed-envelope contract.
- **Executable walkthroughs:** [`docs/walkthroughs/`](./docs/walkthroughs/) — eight tiers, each running real code against a real on-disk repo, verified end to end.

Everything an agent needs is Git-addressable and machine-readable. The human docs (this README, the [live site](https://murmurations-ai.github.io/flyway/)) and the agent surface describe the *same* nine tools — neither is downstream of the other.

---

## What is a murmuration?

A murmuration is any agent swarm answering to a single human **Source**.

> **Source** is used here in the sense developed by [Peter Koenig](https://www.tomnixon.co.uk/) and popularized in Tom Nixon's *Work with Source* (2021): the person who first takes the initiative and the risk on an idea, and who holds the vision, authority, and accountability for it. See [`docs/concepts/defining-source.md`](./docs/concepts/defining-source.md) for a primer.

A murmuration might be a `murmurations-harness` installation, a Claude Code session with subagents, a Cursor or IDE agent workflow, an agent reached through chat, a Source scripting agents directly against LLM APIs, or a human using GitHub by hand. The unifying property is not the runtime — it is a Source whose authority is anchored in a Git-addressable project, with agents or tools acting under that authority.

## What flyway does

flyway exists to support collaboration **between** murmurations. It provides a protocol layer for independent Sources to:

- discover one another
- verify identity and trust
- exchange directives, signals, or governance events
- agree on cross-boundary conventions
- run cross-murmuration governance rounds
- coordinate shared projects or ongoing syndicates
- exit cleanly when collaboration ends or consent fails

## What flyway is not

flyway is **not** a master controller above murmurations, a central authority, a runtime or required daemon, harness-specific, a dependency of `murmurations-harness`, or a mechanism for **forcing** agreement between sovereign Sources.

## What flyway is for

flyway helps sovereign Sources **achieve consent** — surface objections, integrate concerns, and reach agreements every party can stand behind. The distinction from forced agreement is load-bearing: forcing agreement overrides one Source's authority for another's benefit; achieving consent does the work of finding what all parties can support.

It provides explicit primitives for that work: structured proposals, named objections with reasoning, response cycles, pluggable decision rules (S3 consent by default, lazy consent, dual-source sign, and others), and a graduated escalation ladder for tensions that don't resolve quickly. When consent genuinely cannot be reached after good-faith effort, **exit** is a valid outcome — but exit is the *end* of a process, not a substitute for one. Silence is never a valid protocol state.

## Design principles

- **Source sovereignty.** Each Source retains authority over who they federate with, what signals they accept, what their agents do, what agreements they enter, and when they exit.
- **Runtime independence.** The protocol leaks no assumptions from any one runtime — harness, Claude Code, Cursor, or otherwise.
- **Git as system of record.** Each murmuration controls its own authoritative repo. Others may cache, reference, or propose — never overwrite another Source's state.
- **Peer coordination, not control.** flyway coordinates peers; it does not create a hierarchy above them.
- **Small protocol, strong conventions.** Not novel infrastructure — a small set of explicit conventions for identity, recognition, engagement, governance, and exit.

## The nine flyway tools

Defined once in `flyway-core`, exposed through every adapter without rewriting. All nine run end-to-end.

| Tool | Purpose | Status |
| ---- | ------- | ------ |
| `flyway_init` | Mint this murmuration's identity (DID + EdDSA-signed entity statement + Ed25519 keypair) | ✅ Wired |
| `flyway_status` | Report identity, peers, agreements, effective exit-state, and inbox delivery-state | ✅ Wired |
| `flyway_discover` | Search a flyway directory for potential peers (pre-trust; local file or `https://` URL) | ✅ Wired |
| `flyway_recognize` | Verify a peer's identity and write a signed recognition entry (local or `did:web` over HTTPS) | ✅ Wired |
| `flyway_tension` | Flag a tension to a recognized peer (S3 *Navigate via Tension*) | ✅ Wired |
| `flyway_propose` | Drive the full S3 staging chain: driver → requirements → draft → refinement → final | ✅ Wired |
| `flyway_respond` | Answer a tension (acknowledge/dispute/dissolve/transfer) or proposal (accept/object/exit) | ✅ Wired |
| `flyway_check` | Read incoming signals; verify signatures against the recognition-time cached key | ✅ Wired |
| `flyway_exit` | Leave a peer, project, or syndicate — a signed, unilateral notice no peer can prevent | ✅ Wired |

Beyond the nine, agreement **materialization** (`flyway materialize`) turns an accepted final-stage proposal into a co-signed `flyway/agreements/<id>.yaml` — a local act over records both sides already hold. The schemas, descriptions, and protocol instructions in `flyway-core` are the authoritative specification.

## Packages

A small TypeScript monorepo — one package per role in the protocol stack:

| Package | Role | Status |
| ------- | ---- | ------ |
| `@murmurations-ai/flyway-core` | Canonical tool definitions (JSON Schema), protocol instructions, skill factory. Runtime-agnostic. | ✅ Wired |
| `@murmurations-ai/flyway-agent` | Spec-compliant [Agent Skills IO](https://agentskills.io) `SKILL.md` generator. One folder to participate from 30+ agent environments. | ✅ Wired |
| `@murmurations-ai/flyway-mcp` | MCP server (stdio) exposing all nine tools to any MCP-capable client. | ✅ Wired |
| `@murmurations-ai/flyway-cli` | Terminal CLI: `init`, `status`, `recognize`, `tension`, `propose`, `respond`, `check`, `exit`, `materialize`, `skill install/list`. | ✅ Wired |
| `@murmurations-ai/flyway-harness` | `murmurations-harness` adapter. | Reserved |

No client is privileged. The agent skill is the primary interface ([ADR-0004](./docs/adr/0004-agent-skill-as-primary-protocol-interface.md)); everything else is a delivery adapter for the same canonical schemas.

## Protocol concepts

- **Identity:** `did:web` rooted in a Source-controlled repo
- **Entity statements:** signed metadata inspired by OpenID Federation
- **Discovery:** thin Git-hosted directories plus operator-run aggregators
- **Recognition:** explicit pairwise recognition, binding a peer's key and a statement fingerprint at trust-time
- **Engagement agreements:** per-peer or per-project rules co-signed into participating repos
- **Governance:** S3-style consent by default, pluggable per agreement
- **Exit:** clean, unilateral exit as a first-class right

Signing is pluggable through the `Signer` interface ([ADR-0007](./docs/adr/0007-pluggable-signers-and-anchors.md)); a future `flyway-cardano` package will add a Cardano-resident signer and on-chain anchoring without touching `flyway-core`.

## Relationship to murmurations-harness

[`murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness) is a runtime for coordinating agents *within* one murmuration. flyway is the protocol for coordinating *between* murmurations. The harness stays useful without flyway; flyway stays useful without the harness.

## Where to start

- [`docs/status.md`](./docs/status.md) — status dashboard ([visual](https://murmurations-ai.github.io/flyway/status.html)): tools wired, milestones, walkthroughs, open issues.
- [`docs/architecture/how-flyway-works.md`](./docs/architecture/how-flyway-works.md) — sequence diagrams, state machines, contracts ([visual](https://murmurations-ai.github.io/flyway/architecture/how-flyway-works.html)).
- [`docs/walkthroughs/`](./docs/walkthroughs/) — eight executable walkthroughs proving the protocol carries real cross-murmuration acts end to end.
- [`docs/adr/`](./docs/adr/) — 13 accepted architecture decision records (see the [index](./docs/adr/README.md)).

## Name

A **flyway** is an ornithological term for a shared migration corridor used by many independent flocks: a shared route, no central authority, autonomy preserved, coordination by agreement. That is the posture of this project.

## License

MIT — see [`LICENSE`](./LICENSE).

---

<sub>Built for the GimbaLabs **Piece of Pi** hackathon, 2026 · [@Xeeban](https://x.com/Xeeban)</sub>

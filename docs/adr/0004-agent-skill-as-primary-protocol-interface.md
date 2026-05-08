# ADR-0004 — Agent skill as the primary protocol interface

- **Status:** Accepted
- **Date:** 2026-05-08
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

ADR-0003 established the package structure. Before implementing anything in
`flyway-core`, we need to decide what the protocol surface actually looks like
from a participating agent's point of view.

The research paper (§6, §11) described flyway as a three-layer stack: protocol
spec → reference TypeScript core → client integrations. It assumed the primary
artifact of `flyway-core` would be protocol *types and functions* that client
adapters (harness, MCP, CLI, agent) would wrap. This is an infrastructure-first
framing: build the plumbing, then expose it.

There is a simpler framing. Every frontier LLM in active use (Claude, GPT-4/o,
Gemini, Llama-3 with tools) supports tool / function calling with a standard
input/output schema (JSON Schema). This is the shared protocol surface of the
modern agent ecosystem. An "agent skill" in this sense is a bundle of:

1. **Tool definitions** — name, description, input schema, output schema — in
   JSON Schema format. These are the operations the agent can perform.
2. **Protocol instructions** — natural language (system prompt content) that
   teaches the agent *when* and *how* to use those tools, and what the flyway
   protocol means.

Any agent that can load a skill — regardless of which LLM powers it, which
runtime hosts it, or which client it uses — becomes a flyway participant. The
protocol knowledge travels with the skill, not with a daemon, a database, or
any infrastructure the operator must run.

This is consistent with ADR-0001's principle of runtime independence and with
the research paper's emphasis on a "small protocol." The skill *is* the
protocol, in the format agents already understand.

## Decision

**The primary interface for flyway is an installable agent skill.** To join the
flyway, an agent loads the skill. That is sufficient.

### What the skill is

The `flyway-agent` package (per ADR-0003) exports the canonical flyway skill as
a self-contained bundle:

- **Tool definitions** in standard JSON Schema I/O format — the operations a
  flyway participant can perform (discover, recognize, propose directive, respond
  to directive, enter agreement, check signals, exit). These definitions are the
  authoritative protocol surface.
- **Protocol instructions** — a composable system prompt block that explains
  the flyway protocol in terms an LLM can reason about: what a murmuration is,
  what the handshake steps are, how the consent cycle works, when to exit.

The tool definitions and instructions together are the *protocol*. No separate
specification document is load-bearing at runtime; the skill carries everything
an agent needs.

### What `flyway-core` becomes

`flyway-core` is the canonical source for the tool definitions and instructions.
Its primary exports are:

- The typed tool definition objects (TypeScript types derived from the JSON
  Schemas — so authors of adapters get compile-time safety)
- The protocol instructions string (or composable block)
- Pure helper functions that implement each tool's *logic* — reading/writing
  GitHub artifacts, verifying signatures, checking agreement terms — without
  any runtime-specific dependencies

`flyway-core` does not know how a tool call arrives or how a response is
delivered. That is the adapter's concern.

### What the other packages become

Each other package is a **delivery adapter** for the same flyway-agent skill:

| Package | What it does |
|---|---|
| `flyway-mcp` | Wraps the skill's tool definitions as an MCP server (stdio/SSE). Cursor, Continue, and any MCP-capable client load flyway tools this way. |
| `flyway-harness` | Registers the skill's tools as Spirit skills (`:flyway <command>`) in a murmurations-harness installation. |
| `flyway-cli` | Exposes the skill's tools as CLI subcommands (`flyway discover`, `flyway propose`, etc.). |
| `flyway-agent` | Ships the raw skill bundle — tool definitions + instructions — for environments that load skills directly (Claude Code skill loader, OpenAI Assistants, Gemini tool registration, etc.). |

All four adapters call into `flyway-core` for the actual protocol logic. None
of them reimplements the protocol; they only translate between the
runtime's native calling convention and the tool interface.

### The joining ceremony

For an agent to join the flyway:

1. **Load the skill.** Install `flyway-agent` (or the appropriate adapter) into
   the agent's environment. The skill's tool definitions become available to the
   LLM.
2. **Establish identity.** Use the `flyway_init` tool to generate a `did:web`
   document and entity statement in the agent's repo. This is a one-time step.
3. **Participate.** The agent can now use `flyway_discover`, `flyway_recognize`,
   `flyway_propose`, and the other tools. The LLM reasons about *when* and *why*
   using the protocol instructions loaded in step 1.

No daemon, no registration with a central authority, no special infrastructure.
The only requirement is a GitHub-accessible repo for the agent's identity anchor
and an LLM environment that supports tool calling.

### Tool surface (v0.1 candidate list)

These are the operations the skill exposes. Final names and schemas are
implementation decisions; this list fixes the scope.

| Tool | What it does |
|---|---|
| `flyway_init` | Initialize flyway in this agent's repo (generate DID doc + entity statement) |
| `flyway_status` | Report this agent's current flyway state (identity, peers, active agreements) |
| `flyway_discover` | Look up murmurations in a flyway directory by keyword or DID |
| `flyway_recognize` | Propose mutual recognition with a peer (add to `flyway/peers.yaml`, open PR in both repos) |
| `flyway_propose` | Propose a directive, project, or agreement to a recognized peer |
| `flyway_respond` | Respond to an incoming proposal (accept, object with reason, or exit) |
| `flyway_check` | Check for unread incoming signals from peers |
| `flyway_exit` | Exit a peer relationship, project, or syndicate cleanly |

## Consequences

**Positive:**

- Any agent that can use tools can join flyway. The barrier to participation is
  loading a package, not running infrastructure.
- The protocol is self-documenting at runtime. The LLM reads the tool
  descriptions and protocol instructions and understands the protocol without
  consulting external documentation.
- Adapter packages are thin. Each one translates between a runtime's calling
  convention and the tool interface; none reimplements protocol logic.
- The skill format is the common denominator. MCP tool definitions, OpenAI
  function definitions, Anthropic tool use, and Gemini function declarations all
  use JSON Schema for input/output. One canonical definition, many adapters.
- Testing the protocol means testing tool behavior. Unit tests run against
  `flyway-core`'s tool implementations with no runtime dependencies.

**Negative:**

- The protocol instructions (natural language) are necessarily imprecise
  compared to a formal specification. Two LLMs reading the same instructions may
  behave differently. This is inherent to LLM-native protocols; mitigated by
  keeping the tools' JSON Schema contracts strict.
- Tool-calling LLMs can make mistakes — wrong tool, wrong arguments, wrong
  interpretation of a response. The protocol must be designed for graceful
  degradation when an agent misuses a tool. This is a design constraint on the
  tool schemas: inputs must be hard to misuse, outputs must be easy to interpret.
- No formal machine-readable specification separate from the code. Operators who
  want to implement flyway in a language other than TypeScript must derive the
  spec from the tool definitions and instructions in `flyway-core`. This is a
  known gap; a language-agnostic spec can be extracted later.

**Reversibility:** high. The tool definitions are data; they can be extracted
into a separate spec document at any time. The adapter architecture means
changes to the delivery mechanism don't touch the protocol logic. Adding a
formal spec later does not require changing the runtime behavior.

## Alternatives considered

1. **Infrastructure-first (research paper's original framing).** Build the full
   DID resolution stack, entity statement verification, engagement agreement
   engine, and governance plugin machinery first; then expose it to agents
   through client integrations. Rejected as premature. The research paper's
   own conclusion was "flyway is small" and "most of the design work is choosing
   what *not* to build." Starting with infrastructure inverts that priority. The
   skill-first approach reaches a working end-to-end demo (ADR-0001's MVP) with
   far less code.

2. **Formal protocol specification first (RFC-style).** Write a language-agnostic
   spec document, then implement against it. Good for interoperability across
   languages; rejected as premature for v0.1. There is one implementation and
   one team. A formal spec makes sense when a second independent implementation
   exists or is imminent. At that point, the tool definitions in `flyway-core`
   are the natural source of truth to formalize. Not before.

3. **Skill as documentation only; infrastructure as the real interface.**
   Provide the skill as a thin layer over a daemon or server that actually
   implements the protocol. Rejected because it reintroduces a required
   infrastructure dependency (the daemon), which contradicts ADR-0001's "no
   flyway daemon required for participation" decision.

## Links

- [ADR-0001](./0001-project-framing-and-scope.md) — runtime independence
  principle; "no flyway daemon required for participation"
- [ADR-0003](./0003-monorepo-layout.md) — package structure this ADR reframes
- Research paper §6.1 (three-layer architecture), §6.4–6.5 (client integrations,
  participation modes), §11.1 (recommendations 1–5) — original infrastructure
  framing; this ADR supersedes the priority ordering but not the protocol
  content

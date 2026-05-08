# ADR-0003 — Monorepo layout

- **Status:** Accepted
- **Date:** 2026-05-08
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

ADR-0002 fixed the toolchain (TypeScript, pnpm, ESM, Vitest, ESLint/Prettier) but explicitly deferred the repository layout. flyway ships multiple packages with different deployment targets:

- `@murmurations-ai/flyway-core` — protocol primitives; must be runtime-agnostic, usable in Node, browsers, or any JS-capable environment
- `@murmurations-ai/flyway-cli` — terminal one-shot tool; Node binary
- `@murmurations-ai/flyway-mcp` — MCP server; runs as a Node process, connected via stdio or SSE
- `@murmurations-ai/flyway-harness` — harness adapter; peer-imports `@murmurations-ai/murmurations-harness` packages
- `@murmurations-ai/flyway-agent` — agent skill; a runtime-agnostic skill loadable by any frontier LLM agent environment (Claude Code, Cursor, OpenAI Agents, Gemini, etc.)

These packages have different dependency footprints and deployment targets. They share a common substrate (`flyway-core`) and tooling conventions but must be independently installable — a CLI user should not need to install the MCP server's dependencies, and a harness operator should not need the CLI.

The research paper (§11.1, §11.7) named the fifth integration `flyway-claude-code`. Source amended this during ADR review: the agent skill must be runtime-agnostic (Claude Code, Cursor, OpenAI Agents, Gemini, etc.), consistent with ADR-0001's runtime-independence principle. Naming it after a single vendor would contradict that principle and artificially narrow adoption. The package is therefore named `flyway-agent`.

pnpm workspaces (the package manager already chosen in ADR-0002) supports monorepos natively. The question is whether to use it.

## Decision

**A pnpm monorepo with a `packages/` directory.** One repo, five packages, independent publish.

### Directory layout

```
flyway/
├── packages/
│   ├── core/              # @murmurations-ai/flyway-core
│   ├── cli/               # @murmurations-ai/flyway-cli
│   ├── mcp/               # @murmurations-ai/flyway-mcp
│   ├── harness/           # @murmurations-ai/flyway-harness
│   └── agent/             # @murmurations-ai/flyway-agent
├── docs/
│   ├── adr/
│   └── research/
├── pnpm-workspace.yaml
├── package.json           # root — scripts only, no publishable code
├── tsconfig.base.json     # shared compiler options; each package extends it
└── vitest.workspace.ts    # workspace-wide test runner config
```

### Dependency graph (internal only)

```
flyway-core      (no internal deps)
  ↑
  ├── flyway-cli
  ├── flyway-mcp
  ├── flyway-harness
  └── flyway-agent
```

`flyway-core` is the only internal dependency. The four client packages depend on `flyway-core` and on their own external runtime dependencies. No client package depends on another client package. No circular dependencies are permitted.

### Build

`tsc --build` with TypeScript project references. Each package has its own `tsconfig.json` that extends `../../tsconfig.base.json` and declares `references` to any internal dependencies. The root `tsconfig.json` is a solution file that aggregates all packages.

No bundler for `flyway-core` at v0.1 — it ships as compiled ESM with `.d.ts` declarations. `flyway-cli` bundles to a single executable using `esbuild` (or `tsup` over `esbuild`) so the CLI can be installed globally without carrying a `node_modules` subtree. Other packages ship as compiled ESM.

### Scripts

Root `package.json` exposes workspace-wide scripts via `pnpm -r`:

- `build` — `tsc --build`
- `test` — `vitest run` (workspace mode)
- `lint` — ESLint across all packages
- `typecheck` — `tsc --noEmit` across all packages

Individual packages expose the same script names for per-package runs.

## Consequences

**Positive:**

- Single repo: protocol spec, core library, and all client integrations share one issue tracker, one PR flow, and one CI pipeline. A change to a protocol primitive and its downstream clients lands in one PR.
- Independent publish: each package has its own `package.json` with its own version. Operators install only what they need (`npm install @murmurations-ai/flyway-cli`).
- Shared tooling without shared code: `tsconfig.base.json` and root lint config enforce consistency without coupling package output.
- TypeScript project references give incremental builds — changing `flyway-core` only recompiles downstream packages, not the whole tree.

**Negative:**

- Monorepo tooling overhead. Cross-package `pnpm install`, `tsc --build` ordering, and workspace link resolution add friction for first-time contributors. Mitigated by root-level `pnpm install` and a `build` script that handles ordering automatically.
- Versioning complexity. Five packages can drift in version. For v0.1 all packages ship together at the same version (lockstep). Independent versioning is deferred until the packages have meaningfully different release cadences.

**Reversibility:** high. Splitting into separate repos later is mechanical (copy package, update registry references). Merging separate repos into a monorepo later is also feasible but more disruptive. Starting as a monorepo is lower-risk given the packages share a protocol substrate and will frequently need coordinated changes.

## Alternatives considered

1. **Single package (`@murmurations-ai/flyway`).** Simpler to start. Rejected because deployment targets are incompatible: a CLI user should not install harness adapter dependencies, and a harness operator should not install the CLI's binary bundler. Optional peer dependencies can work around this but they are fragile and make the dependency graph implicit.

2. **Separate repos per package.** Maximum isolation. Rejected because a change to a protocol primitive would require coordinated PRs across five repos. For a v0.1 protocol that will iterate frequently, cross-repo coordination is more cost than it saves. Separate repos make sense when packages diverge in release cadence — that is not the expected shape for v0.1.

3. **Turborepo or Nx as the monorepo task runner.** Both add caching and parallelism on top of pnpm workspaces. Rejected for v0.1 as premature complexity — pnpm's built-in `--filter` and `--recursive` flags are sufficient. If build times become a problem, adding Turborepo is additive (it wraps pnpm, it doesn't replace it).

## Links

- [ADR-0001](./0001-project-framing-and-scope.md) — project identity and scope; establishes the five client integrations this layout houses
- [ADR-0002](./0002-typescript-as-implementation-language.md) — toolchain; this ADR inherits all conventions from it
- Research paper §6.1 and §11.1 (recommendations 1–5) — architectural layering that maps to this package structure

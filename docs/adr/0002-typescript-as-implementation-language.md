# ADR-0002 — TypeScript as implementation language

- **Status:** Proposed
- **Date:** 2026-04-27
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

flyway needs an implementation language before any code lands. The harness ([`murmurations-ai/murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness)) is TypeScript with pnpm workspaces, ESM, full strict mode, and Vitest. Operators who run a murmuration already have that toolchain installed.

This ADR fixes only the language choice. Repository layout (single package vs. monorepo) and protocol-format choices (JSON/CBOR/Protobuf/etc.) are separate decisions deferred to later ADRs.

## Decision

**TypeScript**, on the same toolchain conventions as the harness:

- **Runtime:** Node.js 22+ (matches harness `package.json` engines).
- **Module system:** ESM (`"type": "module"`). Per harness ADR-0003.
- **Package manager:** pnpm. Per harness ADR-0001.
- **Strictness:** full `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Per harness ADR-0002.
- **Test framework:** Vitest. Per harness ADR-0008.
- **Lint + format:** ESLint flat config + Prettier. Per harness ADR-0009.

When flyway publishes packages, they will use the `@murmurations-ai/*` scope (e.g., `@murmurations-ai/flyway-client`).

## Consequences

**Positive:**

- One toolchain across the `murmurations-ai/*` family — operators install pnpm/Node once, run both harness and flyway from the same machine.
- TypeScript's structural typing is a natural fit for protocol shape definitions (request/response schemas, identity envelopes, signal payloads). Strong types catch protocol mismatches at compile time, before they cause cross-murmuration confusion.
- Code that bridges harness and flyway (e.g., a harness extension that opts a murmuration into a flyway) can share types directly via `@murmurations-ai/*` packages — no schema generation step.
- The harness's existing strictness and lint conventions transfer wholesale; we don't redesign tooling.

**Negative:**

- Pins the reference implementation to the Node/TS ecosystem. If flyway later needs a non-Node implementation (e.g., a Rust daemon other languages can link against), that becomes a separate language port rather than the reference.
- TypeScript isn't ideal for high-throughput network code at scale. If flyway grows into a high-volume signal relay, we may need a Rust or Go implementation of the hot path. Acceptable for v0.1 — this risk is on the medium-term roadmap, not the early one.

**Reversibility:** medium. Switching languages later is feasible but requires rewriting whatever's been built. Adding a second-language implementation alongside TS is also feasible and probably the path if scale demands it.

## Alternatives considered

1. **Rust.** Better correctness and performance, especially for protocol parsing and high-throughput signal relays. Rejected for v0.1 because it breaks toolchain consistency with the harness — operators would need a second toolchain installed, and shared types between harness and flyway would require a code-gen step (e.g., schemars + ts-rs). Worth revisiting if/when flyway moves to a daemon-grade reference implementation.

2. **Go.** Strong standard library for networking and federation work; reasonable type system. Rejected because no harness component is Go and no shared-type story exists. Same as Rust: viable for a future second implementation, not for the reference.

3. **Python.** Familiar to many AI-tooling developers, low barrier to entry. Rejected because Python's type system is too weak for protocol-design work (mypy/pydantic help but don't enforce at compile time the way TS does), and no harness component is Python.

4. **JavaScript without TypeScript.** Less ceremony, faster to start. Rejected — protocol design needs strict types, and the harness's experience is that TS catches an entire class of cross-package bugs that JS misses (see harness `docs/LINT-DESIGN-GUIDE.md` for patterns).

## Links

- [`murmurations-ai/murmurations-harness`](https://github.com/murmurations-ai/murmurations-harness) — toolchain reference
- Harness ADR-0001 (`pnpm-workspaces.md`), ADR-0002 (`typescript-strict-baseline.md`), ADR-0003 (`esm-module-system.md`), ADR-0008 (`test-framework.md`), ADR-0009 (`lint-format.md`) — the conventions this ADR adopts wholesale

# ADR-0010 — Remote directory fetch (HTTPS)

- **Status:** Accepted
- **Date:** 2026-06-26
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** [remote-transports-v0.2 spec](../architecture/remote-transports-v0.2.md)

## Context

Through SHA `db90614` every flyway operation is local-filesystem: two
murmurations "at a distance" are two directories one process can read. The
[v0.2 transport spec](../architecture/remote-transports-v0.2.md) lays out
the path to genuinely distributed operation and names the first, lowest-risk
step — **fetching a discovery directory over `https://`** (Transport A).

Discovery is the right place to make flyway's first network call because it
is **read-only and pre-trust**: a `FlywayDirectory` is a published list of
*candidate* peers, not attestations. A lying or hostile directory can only
waste your time; it can never forge an identity, because trust is still
established at `flyway_recognize`, which fetches and verifies the
candidate's own signed artifacts. So remote directory fetch needs no
signature machinery — only transport hardening.

This ADR ratifies the directory-fetch half of the spec. The `github-pr`
signal transport (Transport B) is specified but not yet built; it will get
its own ADR when implemented.

## Decision

**`flyway_discover` can load a directory from an `https://` URL as well as a
local file. The fetch is HTTPS-only, refuses private/loopback hosts by
default, and is bounded by a size cap and a timeout. The pure query
(`flywayDiscover`) and the directory schema are unchanged.**

Concretely, in `flyway-core` (`discover.ts`):

- `parseDirectoryLocation(arg)` — classifies an argument: `https://` → remote
  fetch; `http://` → refused (HTTPS-only, before any resolution); anything
  else → local file path.
- `assertPublicHttpsUrl(url, allowPrivate?)` — the SSRF guard. Requires
  `https:`; refuses loopback / RFC-1918 / link-local IP literals and
  `localhost`. `allowPrivate` opts out for local testing.
- `loadDirectory(loc, deps?)` — resolves either location into a validated
  `FlywayDirectory`. Remote fetch uses an `AbortController` timeout
  (default 10 s), a streamed **5 MiB byte cap**, sends
  `Accept: application/json, application/yaml`, and re-checks the final URL
  after redirects so a redirect cannot downgrade off a public HTTPS host.
  All I/O (`fetch`, file read) is injectable, so the policy is fully tested
  without disk or network.

CLI: `flyway discover --directory <path-or-url> [--allow-private-directory]`.
A URL is fetched; a path is read; the rest of the command is unchanged.

**Settled policy values** (the numbers an implementer should not have to
re-derive): size cap 5 MiB, timeout 10 s, redirects followed but re-validated,
content type advisory (we YAML-parse, a JSON superset, regardless).

## Consequences

**Positive:**

- The first non-local-fs operation ships on the safest possible surface —
  read-only, pre-trust, no auth, no write negotiation.
- The SSRF/size/timeout hardening built here is the reusable foundation the
  signal transports (Transport B/C) will sit on.
- Trust model is untouched: a remotely-discovered peer is exactly as
  untrusted as a locally-listed one until `flyway_recognize` verifies it.

**Negative / residual risk:**

- **DNS rebinding** — a public hostname that resolves to a private address
  is not blocked (we guard IP literals and `localhost`, not post-resolution
  addresses). Documented and accepted for v0.2a; resolve-then-pin is a later
  hardening pass. The blast radius is bounded by discovery being pre-trust.
- Adds a network dependency to a previously offline-only tool. Mitigated:
  the local-file path is unchanged and remains the default for tests/demos.

**Reversibility:** high. The remote path is additive — `parseDirectoryLocation`
gates it, and removing it leaves the local-file behaviour intact.

## Alternatives considered

1. **Put the fetch at the CLI edge, keep core pure.** Rejected: core already
   performs fs I/O for signals/agreements (`signal.ts`, `materialize.ts`), so
   a cohesive, injectable `loadDirectory` in core is consistent and far more
   testable than fetch logic stranded in the CLI.
2. **Allow `http://` with a warning.** Rejected: a pre-trust document fetched
   over cleartext is trivially MITM-swappable. The cost of HTTPS-only is zero
   for any real directory host.
3. **No SSRF guard (operator-supplied URL is their problem).** Rejected: a
   hostile *directory link* (one peer's entry pointing at another directory)
   or a typo should not be able to make the tool probe internal services.
   The guard is cheap and the opt-out covers local testing.
4. **Cache fetched directories as trusted.** Rejected: directories are
   pre-trust by construction; caching bytes (politeness) is fine, caching
   *trust* is a category error.

## Links

- [remote-transports-v0.2 spec](../architecture/remote-transports-v0.2.md) — §3 Transport A, which this ADR ratifies
- [ADR-0008](./0008-signal-transport-convention.md) — reserved remote transports; this is the first one realized
- [ADR-0002](./0002-typescript-as-implementation-language.md) — I/O at the edges; honoured via injectable deps
- [`discover.ts`](../../packages/core/src/discover.ts) — `loadDirectory`, `assertPublicHttpsUrl`, `parseDirectoryLocation`

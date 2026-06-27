# ADR-0011 — did:web resolution convention (raw.githubusercontent)

- **Status:** Accepted
- **Date:** 2026-06-26
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** [remote-transports-v0.2 spec](../architecture/remote-transports-v0.2.md), [ADR-0010](./0010-remote-directory-fetch.md)

## Context

ADR-0010 gave `flyway_discover` an HTTPS fetch. The next remote operation
is **recognize-at-a-distance**: a Source resolving a peer's DID document +
signed entity statement over the network so it can recognize a peer it has
never shared a filesystem with. The core `recognizePeer` is already pure
(it takes the fetched documents as input), so this is an edge change — *but*
it forces a decision the local-only path never had to make: **given a
peer's DID, what URL holds its identity artifacts?**

flyway identities are `did:web:github.com:owner:repo` (derived from the
repo URL at `flyway init`). The W3C did:web method maps that to
`https://github.com/owner/repo/did.json` — a path **github.com does not
serve**. GitHub serves repo file content from `raw.githubusercontent.com`
(or GitHub Pages / a custom host). So strict did:web resolution simply
fails for every existing flyway identity. A convention is required, and it
is consequential: it dictates where every murmuration must publish its
identity to be recognizable remotely.

## Decision

**For `did:web:github.com:owner:repo`, resolve identity artifacts from
`https://raw.githubusercontent.com/owner/repo/<branch>/…` — the files the
repo already commits — defaulting `<branch>` to `main`. Other hosts are not
yet supported and fail with a clear, actionable error.**

Resolution map (`didWebResolutionUrls` in `flyway-core/resolve.ts`):

```
did:web:github.com:owner:repo
  → https://raw.githubusercontent.com/owner/repo/main/.well-known/did.json
  → https://raw.githubusercontent.com/owner/repo/main/flyway/entity-statement.json
```

- `resolvePeerIdentity(did, { branch?, … })` fetches both via the shared,
  audited `fetchTextOverHttps` (ADR-0010: HTTPS-only, SSRF guard, size cap,
  timeout), parses JSON, and does a cheap **id-consistency** check
  (`didDocument.id === did`, `entityStatement.did === did`) so an obviously
  wrong document fails fast.
- **Pre-trust.** Resolution only *locates and sanity-checks*. The
  cryptographic verification — signature + verification-key binding — is
  still `recognizePeer`'s job, unchanged. A hostile raw host can serve
  garbage; it cannot forge a recognizable identity.
- CLI: `flyway recognize <did:web:…> [--branch main]`. A `did:` argument
  resolves remotely; anything else is a local path (exactly one).

## Consequences

**Positive:**

- Works **today** for GitHub-hosted murmurations (the norm) with zero new
  infrastructure — recognition reads the same `.well-known/did.json` and
  `flyway/entity-statement.json` the repo already publishes.
- Reuses the ADR-0010 fetch hardening verbatim (one audited network path).
- Trust model intact: remote-fetched artifacts are verified at recognition
  exactly as local ones are.

**Negative / scope:**

- **GitHub-specific.** Not W3C-strict did:web; a `did:web:github.com:*` is
  resolvable by flyway's convention, not by a generic did:web resolver.
  Accepted: flyway DIDs are already github-shaped, and portability is not a
  v0.2 goal.
- **Branch assumption.** Defaults to `main`; `--branch` overrides. A repo
  whose identity lives on another default branch must pass it.
- **Non-github hosts unsupported.** `did:web:example.com:*` throws. When a
  non-github Source appears, extend the resolver (strict did:web for hosts
  that serve `/owner/repo/did.json`, or a per-host convention).

**Reversibility:** high. The convention is isolated in
`didWebResolutionUrls`; switching to strict did:web or adding hosts is a
localized change with no effect on the verified-at-recognition trust path.

## Alternatives considered

1. **Strict W3C did:web** (`https://host/owner/repo/did.json`). Rejected for
   v0.2: GitHub doesn't serve it, so it forces every murmuration onto GitHub
   Pages or a custom host — a publishing burden that blocks the common case.
   Worth revisiting if/when flyway identities stop being github-shaped.
2. **A new DID method** (e.g. `did:flyway:…`). Rejected: invents a method and
   a resolver for no gain over reusing did:web + a hosting convention.
3. **Resolve via the GitHub API** (contents endpoint). Rejected: heavier,
   rate-limited, and auth-coupled for what is a public, pre-trust read;
   raw.githubusercontent is the direct path.

## Links

- [ADR-0010](./0010-remote-directory-fetch.md) — the HTTPS fetch hardening this resolution reuses
- [remote-transports-v0.2 spec](../architecture/remote-transports-v0.2.md) — §10 open decision #2 (DID resolution for recognize-at-a-distance), which this ADR settles
- [`resolve.ts`](../../packages/core/src/resolve.ts) — `didWebResolutionUrls`, `resolvePeerIdentity`
- [ADR-0009](./0009-antecedent-verification-before-signing.md) — the verification that still happens at recognition, over remotely-fetched artifacts

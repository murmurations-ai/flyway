---
date: 2026-06-26
protocol-version: 0.1.0 → 0.2.0 (proposed)
status: draft specification — not yet implemented; informs ADR-0010 / ADR-0011
supersedes: nothing (extends ADR-0008's reserved transports)
---

# Remote transports — v0.2 specification

Everything flyway does today moves bytes across a single filesystem. Two
murmurations "at a distance" are, in v0.1, two directories the same process
can write to. ADR-0008 anticipated this and drew the seam in the right
place — transport is a pluggable concern behind a stable envelope and a
stable on-disk location — but it shipped exactly one transport (`local-fs`)
and reserved the rest. This document specifies the reserved transports and
the one read-only fetch that turns flyway into a genuinely distributed
protocol.

It is a **specification**, not an ADR: it lays out the design space, names
the decisions, and proposes a phasing. The load-bearing decisions it
settles should be ratified as ADR-0010 (HTTPS directory fetch + github-pr
signal transport) and, if pursued, ADR-0011 (url-webhook). Where this doc
says "decision," it means a choice an ADR should record.

---

## 1. What is local-only today

Three places assume one filesystem. All three are already factored so the
remote version is an addition, not a rewrite:

| Concern | v0.1 (local-fs) | The seam |
| --- | --- | --- |
| **Directory fetch** (`flyway_discover`) | CLI reads a directory file from disk, hands the parsed doc to `flywayDiscover` | `flywayDiscover` is pure over a `FlywayDirectory`; loading is the caller's job (`discover.ts` header) |
| **Signal delivery** (`flyway_tension` / `_propose` / `_respond` / `_exit`) | sender writes its own outbox, then `writeSignalToInbox(peerRepoPath, …)` straight into the peer's working tree | ADR-0008 defines delivery as a pluggable transport `(envelope, target) → DeliveryReceipt`; only the local-fs implementation exists |
| **DID resolution** (`flyway_recognize`) | reads the peer's `.well-known/did.json` from a local `peerRepoPath` | `did:web:host:owner:repo` *already encodes* an HTTPS URL; local read is the offline stand-in |

The "spooky action at a distance" ADR-0008 flagged as the negative of
local-fs — the sender's process needing write access to the recipient's
repo — is exactly what remote transport removes.

---

## 2. The transport abstraction (formalize ADR-0008)

ADR-0008 described a transport as a function. v0.2 promotes that to an
explicit interface in `flyway-core`, so the senders stop calling
`writeSignalToInbox` directly and instead call through a transport handed
in by the adapter (CLI / MCP). Pure core, I/O at the edges (ADR-0002).

```ts
/** Where a signal is being delivered — enough for any transport to act. */
export interface DeliveryTarget {
  readonly toDid: string            // did:web:host:owner:repo
  readonly inboxRelPath: string     // flyway/inbox/<host>/<owner>/<repo>/<id>.yaml
  // Transport-specific resolution hints, all optional:
  readonly localRepoPath?: string   // local-fs
  readonly repoUrl?: string         // github-pr (https://github.com/owner/repo)
  readonly webhookUrl?: string      // url-webhook
}

export interface DeliveryReceipt {
  readonly transport: 'local-fs' | 'github-pr' | 'url-webhook'
  readonly delivered: boolean       // false = recorded-in-outbox-only (see §6)
  readonly at: string               // RFC 3339
  readonly ref?: string             // PR url, commit sha, or HTTP 2xx location
  readonly detail?: string          // human-readable status
}

export type SignalTransport = (
  envelope: SignedSignalEnvelope,
  target: DeliveryTarget,
) => Promise<DeliveryReceipt>
```

Invariants every transport must hold (the receiver depends on them):

1. **Outbox-first is not the transport's job.** The sender writes
   `writeSignalToOutbox` *before* invoking any transport. A transport that
   throws or returns `delivered: false` must leave the sender's outbox
   record intact. The act of sending is durable regardless of reachability.
2. **Idempotent on `(from, id)`.** Re-delivering the same envelope is a
   no-op; delivering a *different* envelope to an existing `(from, id)` is
   refused. local-fs enforces this with the `flag: 'wx'` + signature-compare
   guard in `writeSignalFile`; remote transports must reproduce the same
   semantics at their boundary (§5, §7).
3. **Bytes are not interpreted.** A transport moves the canonical envelope
   verbatim. It never re-signs, re-orders keys, or adds fields. The
   signature must verify on the far side over identical bytes.
4. **`flyway_check` stays transport-agnostic.** It reads whatever landed in
   `flyway/inbox/<…>/` and verifies signatures. It must not learn how the
   bytes arrived (ADR-0008). Nothing in v0.2 changes `flyway_check`'s
   contract.

---

## 3. Transport A — HTTPS directory fetch (do this first)

The cheapest, lowest-risk remote operation, and the natural first one
because it is **read-only and pre-trust**. A directory is a published
document; a lying directory can only waste your time, never forge an
identity (you still verify at `flyway_recognize`). So fetching one over the
network needs no signature machinery — only transport hardening.

**Shape.** A `DirectorySource` resolver sits in front of the existing pure
`flywayDiscover`:

```ts
export type DirectoryLocation =
  | { kind: 'file'; path: string }            // v0.1, unchanged
  | { kind: 'https'; url: string }            // v0.2

export async function loadDirectory(
  loc: DirectoryLocation,
  fetcher?: typeof fetch,                      // injectable for tests
): Promise<FlywayDirectory>                     // → parseFlywayDirectory(raw)
```

`flywayDiscover` is untouched: `loadDirectory` fetches, `parseFlywayDirectory`
validates and defensively copies, the query runs as today.

**Hardening (the decisions an ADR records):**

- **HTTPS only.** Refuse `http://`. No redirect to a non-HTTPS scheme.
- **SSRF guard.** The URL is operator-supplied (a directory they chose to
  consult), but still: refuse loopback / link-local / RFC-1918 targets
  unless an explicit `--allow-private-directory` opt-in is set. The guard
  parses IP literals (IPv4 and IPv6) and blocks IPv6 forms that *embed* a
  private IPv4 — IPv4-mapped (`::ffff:…`), NAT64 (`64:ff9b::…`), 6to4
  (`2002:…`) — not just textual prefixes. Redirects are followed manually
  and **each hop is validated before it is contacted** (`redirect:'manual'`),
  so a 30x to a private/`http` target is refused without connecting. DNS
  rebinding (a public name resolving to a private address) remains the one
  residual gap; resolve-then-pin is the later hardening pass.
- **Bounded.** Hard cap on response size (e.g. 5 MiB) and a request timeout
  (e.g. 10 s). A directory is a small document; anything large is a fault.
- **Content type.** Accept `application/json` / `application/yaml`; parse by
  declared type, fall back to sniffing only within the size cap.
- **No caching of trust.** A fetched directory is informational and
  ephemeral. We may cache the *bytes* (with an ETag) to be polite, but never
  treat a cached entry as more trusted than a fresh fetch — it is pre-trust
  by construction.

**CLI surface.** `flyway discover <query> --directory <path-or-url>`. If the
argument parses as an `https:` URL, use the https loader; otherwise treat as
a file path. No new verb.

**Why first:** read-only, no auth, no write-access negotiation, no new
signature paths. It exercises the network stack and the SSRF/timeout
hardening that the signal transports will reuse, on the operation where a
mistake is least costly.

---

## 4. Transport B — github-pr signal delivery (the production transport)

The durable, auth-realistic transport ADR-0008 named as production. The
sender does not write into the recipient's tree; it **opens a pull request**
against the recipient's repo adding the inbox file. The recipient merges or
rejects under their own governance. This is flyway's offline-first,
git-native stance made concrete: delivery is a proposal the receiver
consents to, mirroring the protocol's own consent semantics.

**Flow:**

```
sender                                   recipient repo (github)
──────                                   ────────────────────────
1. writeSignalToOutbox(self, env)        (local, always)
2. resolve target repo from did:web      https://github.com/owner/repo
3. branch: flyway/inbox/<from>/<id>      via gh api / fork-or-push
4. add flyway/inbox/<…>/<id>.yaml        (exact canonical bytes)
5. open PR ───────────────────────────►  PR appears; CI may verify-signal
6. DeliveryReceipt{delivered:true,        recipient merges → file lands in
   ref: <pr-url>}                         flyway/inbox; flyway_check sees it
```

**Decisions:**

- **Auth.** Use the GitHub CLI (`gh`) credential already on the operator's
  machine; do not invent a secret store. The transport shells `gh api` /
  `gh pr create`. If `gh` is absent or unauthenticated, the transport
  returns `delivered: false` with an actionable detail — the outbox record
  still stands.
- **Fork vs. direct branch.** If the sender lacks push access to the
  recipient repo (the normal case across an org boundary), push the branch
  to a fork and open the PR cross-repo. Decision: prefer fork-based; fall
  back to direct branch only when push access exists.
- **Idempotency.** `(from, id)` maps to a deterministic branch name
  (`flyway/inbox/<sanitized-from>/<id>`). Re-running finds the existing
  branch/PR and is a no-op. A different envelope at the same `(from, id)` is
  refused before any network call (the sender already holds the outbox copy
  to compare against).
- **The merge is the recipient's act.** Delivery `delivered: true` means
  "PR is open," not "signal is in the inbox." A second status — derivable by
  `flyway_check` once the file lands, or by polling the PR — distinguishes
  *offered* from *accepted*. Decision: v0.2 reports PR-open as delivery;
  acceptance is observed downstream, not awaited synchronously.
- **Optional recipient-side CI.** Ship a reusable `verify-signal` GitHub
  Action: on a PR touching `flyway/inbox/**`, run `flyway check` on the
  added file and comment the verdict (sender recognized? signature valid?
  `sentAt` sane per Issue #16?). This lets a recipient automate the consent
  decision without trusting the PR author. Reuses existing `flywayCheck`.

**Security:**

- The PR author is *claimed*, not trusted. Recognition still happens on the
  recipient's side: the merged signal is only meaningful if `from` is a
  recognized peer whose cached DID key verifies the envelope. github-pr
  changes who can *offer* a signal, never who is *trusted*.
- A flood of PRs is a spam vector, not a forgery vector. Mitigation is
  ordinary GitHub abuse tooling plus the `verify-signal` Action auto-closing
  PRs from unrecognized DIDs.

---

## 5. Transport C — url-webhook (optional, lower priority)

A recipient publishes an HTTPS endpoint that accepts a signed envelope.
Lower latency than a PR, at the cost of an **online dependency the rest of
flyway deliberately avoids** (ADR-0008). Specify it, gate it behind real
demand.

- `POST <webhookUrl>` with the canonical envelope as the body; `2xx` ⇒
  `delivered: true` with the response location as `ref`.
- The endpoint is responsible for writing `flyway/inbox/<…>/<id>.yaml` with
  the same idempotency guard. It SHOULD run `flywayCheck` before persisting
  and MAY reject (`409`) a differing `(from, id)`.
- The endpoint URL is advertised where? Decision deferred: either a new
  optional `serviceEndpoint` in the peer's DID document (did-core native) or
  a directory-entry field. did:web `serviceEndpoint` is the cleaner home and
  costs nothing to read during recognition.
- **Do not build until a consumer needs sub-PR latency.** It trades flyway's
  best property (works offline, leaves an auditable git trail on both sides)
  for speed. The bar to adopt is a real use case, not symmetry with B.

---

## 6. Cross-cutting: retries, dedup, failure (Issue #18)

Issue #18 (sender-side retry / dedup semantics) is the natural companion to
this work — remote delivery is where "the network was down" becomes real.

- **Recorded vs. delivered.** Outbox write = recorded; transport success =
  delivered. A `DeliveryReceipt{delivered:false}` is a normal outcome, not an
  error: the signal is durably recorded and can be re-attempted. Senders and
  `flyway_status` should surface "N signals recorded, M undelivered."
- **Retry is re-running the send.** Because every transport is idempotent on
  `(from, id)`, "retry" is literally invoking the transport again with the
  same outbox envelope. No retry queue in core; the operator (or a cron)
  re-runs. A `flyway resend <id>` convenience verb can wrap this.
- **No partial writes.** A transport either lands the whole canonical file or
  nothing. github-pr gets this from git atomicity; url-webhook endpoints must
  write-temp-then-rename; local-fs already uses `flag: 'wx'`.
- **Clock skew / ordering.** Out of scope here, tracked by Issue #16
  (`flyway_check` flags responses whose `sentAt` precedes their subject).
  Transport does not reorder; it preserves `sentAt` as signed.

---

## 7. Idempotency at the boundary (the one subtle invariant)

local-fs enforces "same `(from,id)` ⇒ identical bytes or refuse" in
`writeSignalFile` with `flag: 'wx'` and a signature comparison. Each remote
transport must reproduce this at its own boundary, because the guarantee
receivers rely on (`flyway_check` treats `(from,id)` as unique) is only as
strong as the weakest writer:

| Transport | Where the guard lives |
| --- | --- |
| local-fs | `writeSignalFile` (`wx` + signature compare) — exists |
| github-pr | deterministic branch name per `(from,id)`; PR-exists check; recipient merge can't duplicate a path | 
| url-webhook | endpoint MUST `409` a differing `(from,id)`; identical re-POST ⇒ `200` no-op |

This is the single property most likely to be got wrong, so it is called out
on its own. A transport that lets a sender silently overwrite a delivered
signal with different bytes breaks the audit trail for everyone downstream.

---

## 8. Phasing

Each phase produces behaviour and a walkthrough, matching the project's
implement → walkthrough → review → harden cadence.

| Phase | Scope | Walkthrough it unlocks |
| --- | --- | --- |
| **v0.2a** | **shipped.** Transport A (HTTPS directory fetch, ADR-0010: `loadDirectory` / `assertPublicHttpsUrl` / `parseDirectoryLocation`) **and** the `SignalTransport` seam (`sendSignal` / `localFsTransport`; all four senders deliver through a transport) | Tier 6 — discover a peer from a *remote* directory, then recognize it from its `did:web` URL |
| **v0.2b** | Transport B (github-pr) + `verify-signal` Action | Tier 7 — a tension delivered by PR across two real GitHub repos; recipient's CI verifies; merge lands it in the inbox |
| **v0.2c** | Transport C (url-webhook) — only if a consumer needs it | — |

v0.2a is the keystone: the interface refactor is what lets B and C drop in
without touching the senders, exactly as ADR-0008 intended.

---

## 9. What does NOT change

- The **envelope** (ADR-0008) — same `flyway-signal-v0`, same kind-specific
  domains, same signature. Remote transport moves identical bytes.
- The **on-disk location** — `flyway/inbox/<host>/<owner>/<repo>/<id>.yaml`.
  A remote-delivered signal is indistinguishable on disk from a local one.
- **`flyway_check`** — reads the inbox, verifies, reports. Transport-blind.
- **The trust model** — recognition is still the only trust act; transport
  decides who can *offer* bytes, never who is *believed*. A remote sender is
  exactly as untrusted as a local one until recognized.
- **Offline-first** — outbox-first delivery means a Source can operate fully
  disconnected and reconcile later. Remote transport adds reach; it does not
  add an online *requirement* (url-webhook being the deliberate exception,
  hence its low priority).

---

## 10. Open decisions for the ADRs

1. **ADR-0010 (HTTPS directory fetch):** ✅ **accepted** — the SSRF/size/
   timeout policy of §3 is settled and shipped. The `github-pr` decisions
   (fork-vs-branch default of §4; "PR-open = delivered" semantics; whether
   `verify-signal` ships here or in a companion action repo) move to a
   future ADR when Transport B is built.
2. **DID resolution for recognize-at-a-distance:** ✅ **accepted (ADR-0011).**
   `flyway_recognize` now resolves a `did:web:github.com:owner:repo` peer to
   its raw.githubusercontent identity artifacts and recognizes it with no
   shared filesystem (Tier 6). Reuses the §3 fetch hardening; verification
   still happens at recognition. Non-github hosts remain unsupported.
3. **ADR-0011 (url-webhook):** only if §5's demand bar is met. Where the
   endpoint is advertised (`serviceEndpoint` vs. directory field) is the
   first decision.

---

## Links

- [ADR-0008](../adr/0008-signal-transport-convention.md) — the seam this spec fills in (envelope / location / transport split; reserved github-pr & url-webhook)
- [ADR-0007](../adr/0007-pluggable-signers-and-anchors.md) — pluggable signers; remote transports reuse the same Signer/verify path untouched
- [ADR-0002](../adr/0002-typescript-as-implementation-language.md) — pure core, I/O at the edges; the `SignalTransport` interface honours this
- [`discover.ts`](../../packages/core/src/discover.ts) — the reserved HTTPS fetch seam (module header) + `FlywayDirectory` shape
- [`signal.ts`](../../packages/core/src/signal.ts) — `writeSignalToInbox/Outbox`, `writeSignalFile` idempotency guard, `signalInboxPath`
- [Issue #18](https://github.com/murmurations-ai/flyway/issues/18) — sender-side retry / dedup; addressed by §6/§7
- [Issue #16](https://github.com/murmurations-ai/flyway/issues/16) — `sentAt` ordering; transport preserves `sentAt`, check enforces

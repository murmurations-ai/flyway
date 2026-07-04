# ADR-0012 — github-pr signal transport

- **Status:** Accepted
- **Date:** 2026-07-02 (accepted 2026-07-04)
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** [remote-transports-v0.2 spec](../architecture/remote-transports-v0.2.md) §4, §7

## Context

Through ADR-0010 / ADR-0011 flyway can *discover* and *recognize* a peer over
HTTPS with no shared filesystem — but it still can only *deliver a signal*
into a peer's inbox by writing that peer's working tree directly
(`localFsTransport`). That is the "spooky action at a distance" ADR-0008
flagged: the sender's process needs write access to the recipient's repo.
Across an organizational boundary — the whole point of flyway — the sender
has no such access, and should not.

The [v0.2 transport spec](../architecture/remote-transports-v0.2.md) names
`github-pr` as the **production** transport (§4): the sender does not write
into the recipient's tree, it **opens a pull request** adding the inbox
file, and the recipient merges under their own governance. Delivery becomes
a proposal the receiver consents to — mirroring the protocol's own consent
semantics, and preserving flyway's offline-first, git-native, auditable-on-
both-sides posture.

The seam this rides on already exists. v0.2a (ADR-0008 formalized) shipped
`SignalTransport`, `DeliveryTarget` (with a reserved `repoUrl`), and
`DeliveryReceipt` (with a reserved `'github-pr'` tag). All four senders
deliver *through* `sendSignal`, which writes the outbox first and then calls
the transport. A new transport drops in without touching any sender — which
was the whole point of cutting the seam. This ADR ratifies the decisions
§4/§7 leave to the implementer, so the build is mechanical.

## Decision

**Add a `githubPrTransport: SignalTransport` that delivers a signed envelope
by opening a pull request against the recipient's repo, adding the canonical
`flyway/inbox/<host>/<owner>/<repo>/<id>.yaml` verbatim. Delivery success
means "PR is open," not "signal is in the inbox." The recipient's merge is
their consent act. Trust is unchanged: recognition remains the only trust
decision; github-pr changes only who may *offer* bytes.**

The load-bearing decisions:

1. **PR-as-delivery.** The transport resolves the target repo from the
   recipient DID (`did:web:github.com:owner:repo` → `github.com/owner/repo`),
   creates a branch, adds the inbox file with the *exact canonical envelope
   bytes* (no re-serialization, no re-signing — invariant 3), and opens a PR.
   `DeliveryReceipt.ref` is the PR URL.

2. **`delivered: true` = PR-open, not merged.** The receipt reports that the
   signal was *offered*, not accepted. Acceptance is observed downstream —
   `flyway_check` sees the file once the PR merges — never awaited
   synchronously. This keeps the transport non-blocking and honours "the
   merge is the recipient's act."

3. **Auth via the operator's `gh` CLI.** The transport shells `gh api` /
   `gh pr create` against the credential already on the machine. **No secret
   store is invented.** If `gh` is absent or unauthenticated, the transport
   returns `delivered: false` with an actionable `detail` — the outbox record
   still stands (invariant 1), so the send is durable and re-runnable.

4. **Fork-based by default; direct branch only with push access.** The normal
   cross-boundary case is no push access to the recipient repo, so the
   default is: push the branch to the sender's fork and open the PR
   cross-repo. Fall back to a direct branch on the recipient repo *only* when
   push access is detected. Prefer fork; never assume write.

5. **Idempotency at the boundary (§7).** `(from, id)` maps to a deterministic
   branch name (`flyway/inbox/<sanitized-from>/<id>`). Re-running finds the
   existing branch/PR and is a no-op (returns the existing PR URL). A
   *differing* envelope at the same `(from, id)` is refused **before any
   network call** — the sender already holds the outbox copy to compare
   against. This reproduces local-fs's `wx` + signature-compare guarantee at
   the github boundary, so receivers can keep treating `(from, id)` as unique.

6. **`verify-signal` GitHub Action ships in this repo.** A reusable workflow
   under `.github/workflows/verify-signal.yml` (plus a thin composite action)
   runs on any PR touching `flyway/inbox/**`: it runs `flyway check` on the
   added file and comments the verdict (sender recognized? signature valid?
   `sentAt` sane per Issue #16?) — and MAY auto-close PRs from unrecognized
   DIDs. Shipping it here (versioned with the protocol) rather than in a
   companion repo keeps the check in lockstep with the envelope format it
   validates; a recipient references it with a tagged `uses:`.

**Settled policy values** (so an implementer need not re-derive): branch name
`flyway/inbox/<sanitized-from>/<id>` where `<sanitized-from>` replaces `:`
and `/` with `-`; PR title `flyway signal <kind> from <from-did>`; PR body
carries the envelope id, kind, and `from`/`to` DIDs for reviewer context;
`gh` invoked with `--repo owner/repo`; all `gh` calls are injectable (a
`runGh` dependency) so the transport is tested without network or a real
GitHub.

## Consequences

**Positive:**

- Removes the last local-fs assumption from *delivery* — two murmurations at
  a genuine distance can now exchange signals with no shared filesystem and
  no write access to each other's trees. This completes the distributed loop:
  discover (ADR-0010) → recognize (ADR-0011) → **deliver (this)**.
- Delivery-as-PR is consent-shaped: the receiver's merge is a governance act,
  auditable on both sides (sender's outbox + recipient's merged PR). This is
  more faithful to S3 semantics than a silent write ever was.
- Reuses the ADR-0010 HTTPS/SSRF/timeout hardening for DID→repo resolution;
  no new network-safety surface beyond the `gh` shell-out.
- The `verify-signal` Action lets a recipient automate the consent decision
  without trusting the PR author — recognition runs in *their* CI, on *their*
  cached keys.

**Negative / residual risk:**

- **Online + `gh` dependency for this transport.** github-pr needs network
  and an authenticated `gh`. Mitigated: it is opt-in per send; local-fs
  remains the default and the fully-offline path. `delivered: false` is a
  normal, durable outcome (Issue #18 / §6), not an error.
- **Spam vector.** Anyone can open a PR; a flood is a nuisance. This is a
  *spam* vector, not a *forgery* vector — the PR author is claimed, never
  trusted, and `verify-signal` auto-closes unrecognized-DID PRs. Residual
  abuse is handled by ordinary GitHub tooling, not by flyway.
- **Shell-out coupling to `gh`.** The transport depends on the `gh` CLI's
  surface. Mitigated by isolating every invocation behind an injectable
  `runGh` and asserting on its arguments in tests; swapping to the REST API
  later is a transport-internal change.

**Reversibility:** high. Purely additive — a new `SignalTransport` behind the
existing seam plus one CI workflow. Removing it leaves local-fs and every
sender untouched. No envelope, on-disk-location, or trust-model change.

## Alternatives considered

1. **url-webhook first (Transport C).** Rejected for now: lower latency but
   trades flyway's best property — works offline, leaves an auditable git
   trail on both sides — for an online *requirement*. The spec (§5) gates it
   behind real sub-PR-latency demand; github-pr is the production default.
2. **Direct branch push by default (assume collaborator access).** Rejected:
   across an org boundary the sender almost never has push access, and
   assuming it turns the common case into an error. Fork-first matches
   reality; direct-branch is the optimization when access happens to exist.
3. **Await merge before returning `delivered: true`.** Rejected: merging is
   the recipient's act on their own timeline; blocking the sender on it
   couples delivery to a human/CI decision and breaks offline-first.
   PR-open = delivered; acceptance is observed via `flyway_check`.
4. **Invent a token/secret store for auth.** Rejected: the operator already
   has an authenticated `gh`. Reusing it is zero new secret-management
   surface; absence degrades cleanly to `delivered: false`.
5. **Ship `verify-signal` in a companion action repo.** Rejected: the check
   validates the envelope format, so it must move in lockstep with it.
   Versioning it alongside the protocol (tagged `uses:`) avoids drift between
   a released envelope and a lagging external action.

## Links

- [remote-transports-v0.2 spec](../architecture/remote-transports-v0.2.md) — §4 Transport B (github-pr), §7 idempotency at the boundary, §8 phasing (v0.2b)
- [ADR-0008](./0008-signal-transport-convention.md) — the reserved transport this realizes
- [ADR-0010](./0010-remote-directory-fetch.md) — HTTPS/SSRF/timeout hardening reused for DID→repo resolution
- [ADR-0011](./0011-did-web-resolution-convention.md) — `did:web:github.com:owner:repo` resolution, reused to locate the target repo
- [ADR-0002](./0002-typescript-as-implementation-language.md) — pure core, I/O at the edges; honoured via an injectable `runGh`
- [`transport.ts`](../../packages/core/src/transport.ts) — `SignalTransport`, `DeliveryTarget.repoUrl`, `DeliveryReceipt` `'github-pr'` tag (all reserved for this)
- [Issue #18](https://github.com/murmurations-ai/flyway/issues/18) — sender-side retry / dedup; `delivered: false` + idempotent re-send
- [Issue #16](https://github.com/murmurations-ai/flyway/issues/16) — `sentAt` ordering; `verify-signal` surfaces it

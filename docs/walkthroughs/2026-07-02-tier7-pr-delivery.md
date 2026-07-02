---
date: 2026-07-02
protocol-version: 0.2.0 (proposed)
kind: executable (test-backed)
tools-exercised: [flyway_tension, flyway_check]
outcome: a signal is delivered by opening a pull request against the peer's repo — no write access to their tree; the recipient merges to accept
---

# Tier 7 — Delivery by pull request

Every prior tier delivered a signal by *writing the recipient's working
tree* — the sender's process needed write access to the peer's repo. That is
the "spooky action at a distance" ADR-0008 flagged, and it only works when
"two murmurations" are two directories one process can reach. This tier
removes it: the sender **opens a pull request** against the recipient's repo
adding the inbox file, and the recipient **merges under their own
governance**. Delivery becomes a proposal the receiver consents to —
mirroring the protocol's own consent semantics.

This exercises v0.2b: the `github-pr` transport (ADR-0012) dropped in behind
the `SignalTransport` seam v0.2a cut, plus the recipient-side `verify-signal`
GitHub Action.

## Why this is "test-backed" executable

A *real* cross-repo PR needs two live GitHub repos, credentials, and network
— which a hermetic, reproducible script can't assume (same reason Tier 6 is
test-backed). So the executable evidence is the **test suite**: it runs the
real `createGithubPrTransport` code path against an **injected `gh`**
(`RunGh`) that records every argv and returns canned GitHub responses. The
branch name, the base64 file bytes, the fork-vs-direct decision, the
idempotency no-op, and the clean-degradation paths are all real; only the
`gh` shell-out is stubbed — exactly the seam ADR-0012 makes injectable.

Reproduce:

```bash
pnpm -r build
pnpm --filter @murmurations-ai/flyway-core test github-pr   # transport call sequence + bytes
```

## The flow

```
sender A (did:web:github.com:xeeban:a)         recipient B repo (github.com/emergent/praxis)
──────────────────────────────────────         ─────────────────────────────────────────────
flyway tension <B> --conditions … --effect …
   --transport github-pr
1. build + sign envelope (unchanged)
2. writeSignalToOutbox(A)  ── durable record, BEFORE any network (invariant 1)
3. githubPrTransport:
     gh auth status                → authenticated?
     gh api user                   → login = xeeban  (fork owner)
     gh api repos/emergent/praxis  → default_branch=main, push=false
     gh repo fork emergent/praxis  → fork-first (no push access)
     gh api …/pulls?head=xeeban:…  → none yet (idempotency probe)
     gh api POST …/git/refs        → branch flyway/inbox/<A>/<id>
     gh api PUT  …/contents/<path> → the EXACT inbox bytes, base64
     gh api POST …/pulls           → PR opened  ──────────────────►  PR appears
4. DeliveryReceipt{delivered:true, ref:<pr-url>}                     verify-signal Action runs
                                                                     `flyway check` on the added
                                                                     file, comments the verdict
   PR-open = delivered (ADR-0012); acceptance is the merge,          B merges → file lands in
   observed downstream by flyway_check — not awaited synchronously.  flyway/inbox; flyway_check
                                                                     sees it, transport-blind.
```

The file the PR adds is **byte-identical** to what `localFsTransport` would
have written — `renderInboxSignalFile` is the single source of truth for both
(ADR-0008 invariant 3). Once merged, `flyway_check` cannot tell a
PR-delivered signal from a locally-written one; the signature verifies over
the same bytes either way.

## What the test proves

| Property | Assertion |
| --- | --- |
| **PR-open = delivered** | receipt `{transport:'github-pr', delivered:true, ref:<pr-url>}` |
| **Fork-first without push access** | `gh repo fork` is called; PR head is `xeeban:<branch>` |
| **Direct branch with push access** | no fork; PR head is `emergent:<branch>` |
| **Bytes verbatim** | the base64 `content=` argument decodes to `renderInboxSignalFile(envelope)` exactly |
| **Deterministic branch (idempotency key)** | `flyway/inbox/<sanitized-from>/<id>` |
| **Idempotent re-send** | an existing PR is returned as a no-op; no branch/file/PR-create calls |
| **Clean degradation** | `gh` missing / unauthenticated / repo unreachable / fork blocked → `delivered:false`, outbox intact |
| **Trust boundary** | a non-`github.com` did is refused (ADR-0011); recognition, not transport, is the trust act |

## Gaps surfaced

- **G-T7-1 — DNS/credential realities are unproven here.** The test stubs
  `gh`; a real two-repo run (private→fork→PR→merge→check) is the manual
  validation this walkthrough stands in for. Tracked for a live demo once a
  second real murmuration repo exists.
- **G-T7-2 — "offered vs. accepted" is not yet surfaced by `flyway_status`.**
  A `delivered:true` receipt means *PR open*, not *merged*. Issue #17
  (`flyway_status` should surface inbox/outbox state) is the natural home for
  an "N offered, M accepted" view.
- **G-T7-3 — sender-side resend ergonomics.** `delivered:false` is durable
  and re-runnable, but there is no `flyway resend <id>` convenience verb yet
  (spec §6). Filed against Issue #18.

## Relationship to the protocol

github-pr is the **production** transport ADR-0008 named. With Tier 6
(discover + recognize at a distance) and this tier (deliver at a distance),
the full cross-murmuration loop now runs with **no shared filesystem**:
discover → recognize → deliver, each over the network, each verified by the
recipient against keys they hold. What remains (url-webhook, ADR-0012 §5) is
gated on real sub-PR-latency demand — not symmetry.

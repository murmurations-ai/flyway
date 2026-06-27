---
date: 2026-06-26
protocol-version: 0.2.0 (proposed)
kind: executable (test-backed)
tools-exercised: [flyway_discover, flyway_recognize]
outcome: a peer is discovered from a remote HTTPS directory and recognized from its did:web URL — the first flow with no shared filesystem
---

# Tier 6 — Remote discovery and recognition

The first walkthrough where the two murmurations **do not share a
filesystem**. Every prior tier had A and B as two directories one process
could read; the "remote" was a convenience for demos. Here the only thing A
has about B is B's `did:web` identifier and a directory URL — and from those
alone A discovers B and recognizes it, fetching B's identity over HTTPS and
verifying the signature exactly as it would a local peer.

This closes the gap Tier 1 explicitly left open ("recognition **at a
distance** … is a separate milestone") and exercises v0.2a end-to-end:
HTTPS directory fetch (ADR-0010) + `did:web` resolution (ADR-0011).

## Why this is "test-backed" executable

Prior tiers ran the CLI against on-disk repos and pasted the transcript.
A *remote* flow needs a network peer, which a hermetic, reproducible script
can't assume. So the executable evidence here is the **test suite**, which
runs the real `loadDirectory` / `resolvePeerIdentity` / `recognizePeer`
code paths against an **injected fetch** that serves a real peer's real
signed artifacts — no network, fully reproducible with `pnpm test`. The
bytes, signatures, and verification are real; only the transport is stubbed,
which is exactly the seam v0.2 makes pluggable.

Reproduce:

```bash
pnpm -r build
pnpm --filter @murmurations-ai/flyway-core test resolve   # resolution + fetch guard
pnpm --filter @murmurations-ai/flyway-cli  test recognize # remote recognize, verified
```

## The flow

```
A knows: B's did  (did:web:github.com:xeeban:b)  +  a directory URL
         ─────────────────────────────────────────────────────────
1. discover   flyway discover --directory https://dir.example/list.yaml "governance"
                 → loadDirectory fetches over HTTPS (HTTPS-only, SSRF-guarded,
                   size/timeout-bounded), flywayDiscover filters. B appears.
2. resolve    did:web:github.com:xeeban:b
                 → https://raw.githubusercontent.com/xeeban/b/main/.well-known/did.json
                 → https://raw.githubusercontent.com/xeeban/b/main/flyway/entity-statement.json
3. recognize  flyway recognize did:web:github.com:xeeban:b
                 → resolvePeerIdentity fetches both, sanity-checks ids,
                   recognizePeer VERIFIES the signature + key binding,
                   writes a signed recognition entry + peer cache.
```

After step 3, A's `flyway/peers/github.com/xeeban/b/{did.json,entity-statement.json}`
and a signed `peers.yaml` entry are **byte-for-byte what local recognition
would have produced** — the source of the bytes is invisible to everything
downstream (`flyway_check`, `flyway_status`, every sender).

## What this proves

| Claim | Evidence |
| --- | --- |
| A directory can be fetched over HTTPS, not just read from disk. | `loadDirectory({kind:'https',…})` → `fetchTextOverHttps`; `discover.test.ts` / `runDiscover` https test. |
| The fetch path is hardened. | HTTPS-only, private/loopback refused **before** any network call, size cap, timeout, redirect re-validation — `discover.test.ts` (`assertPublicHttpsUrl` + `loadDirectory`) and `resolve.test.ts` (404 propagation). |
| A `did:web:github.com` peer resolves to its published artifacts. | `didWebResolutionUrls` maps to the raw.githubusercontent URLs; `resolve.test.ts`. |
| Recognition works with no shared filesystem. | `runRecognize({ peerDid, fetchImpl })` produces the same signed entry + cache as the local path; `recognize.test.ts` remote suite. |
| Trust is still established at recognition, not by transport. | Tampering with the remotely-fetched entity statement flips recognition to *does not verify* — `recognize.test.ts` "still verifies … (tamper rejected)". |
| Source of bytes is invisible downstream. | The peer cache written from a remote fetch is identical to the local-recognition cache. |

## What this does NOT prove

- **A real network round-trip.** The transport is injected; a live fetch
  against raw.githubusercontent is not part of the hermetic suite. The
  guard logic (HTTPS-only, SSRF, caps, redirects) is tested, but TLS and
  real DNS are not exercised here.
- **DNS rebinding resistance.** A public host that resolves to a private
  address is not blocked (documented residual risk, ADR-0010/0011).
- **Non-github did:web hosts.** `did:web:example.com:*` is refused by
  design (ADR-0011) until a non-github Source needs it.
- **Signal exchange at a distance.** Recognizing remotely doesn't yet mean
  *delivering* remotely — that is v0.2b (the github-pr transport), which the
  `SignalTransport` seam (S+10) is now ready for.

## Where it goes next

With remote discover + recognize proven, the last reach milestone is
**v0.2b — github-pr signal delivery**: a recognized-at-a-distance peer
receiving a tension/proposal by PR instead of a shared inbox directory.
That implements `SignalTransport` (S+10) for real remote delivery and would
be the first walkthrough with bytes crossing between two genuinely separate
repos.

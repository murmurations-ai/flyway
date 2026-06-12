# flyway demo

Keep this open in one window during the meeting. Copy-paste the commands;
narrate the beats. Total runtime ~6–8 minutes for the full consent cycle;
~3 minutes if you stop at first acknowledge.

---

## Pre-flight (5 min before Newman arrives)

```bash
cd /Users/nnishigaya/Code/flyway
git status                                          # working tree clean? ✓
pnpm --filter '!@murmurations-ai/flyway-harness' -r build 2>&1 | tail -3
ls packages/cli/dist/bin/flyway.js                  # exists? ✓
```

Run the full smoke once dry to confirm nothing's broken:

```bash
A=$(mktemp -d) && B=$(mktemp -d) && CLI=/Users/nnishigaya/Code/flyway/packages/cli/dist/bin/flyway.js
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Test") > /dev/null
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Test") > /dev/null
(cd "$A" && node "$CLI" recognize "$B") > /dev/null && (cd "$B" && node "$CLI" recognize "$A") > /dev/null
(cd "$A" && node "$CLI" tension "$B" --conditions "X" --effect "Y") | grep id:
rm -rf "$A" "$B"
echo "Pre-flight ✓"
```

If anything errors, stop and debug before Newman arrives.

---

## Window layout

Best in **two terminals side-by-side** — left is murmuration A (Nori), right is
murmuration B (Praxis). Open a third tab/pane on top with this runbook visible.
If only one terminal is available, prefix every command with the obvious `(cd …)`
to make ownership visible.

You'll want a **YAML viewer** ready too — VS Code, `bat`, or even `cat`. After
each signal, you can show the actual signed envelope on disk.

---

## Setup (~30 seconds — run once at the top of the demo)

In a terminal where you'll keep the shell vars around:

```bash
export A=$(mktemp -d)
export B=$(mktemp -d)
export CLI=/Users/nnishigaya/Code/flyway/packages/cli/dist/bin/flyway.js
echo "A_DIR=$A"
echo "B_DIR=$B"
```

> 💬 *Tell Newman:* "These are two completely independent temp directories. No
> shared database, no central server. Each one becomes a murmuration."

```bash
(cd "$A" && node "$CLI" init --repo-url https://github.com/xeeban/a --source-name "Nori")
(cd "$B" && node "$CLI" init --repo-url https://github.com/emergent/praxis --source-name "Praxis")
```

> 💬 *Point at the output:* "Each `init` produced a DID, a signed entity
> statement, and an Ed25519 keypair. The private key is in `flyway/keys/source.key`
> and is gitignored. The DID document at `.well-known/did.json` is the public
> handle."

Optional: show the disk shape on one side:

```bash
tree "$A" -L 3 2>/dev/null || find "$A" -type f
```

---

## Beat 1 — Mutual recognition (~30 sec)

Each side independently verifies the other and signs a recognition entry.

```bash
(cd "$A" && node "$CLI" recognize "$B" --note "Newman demo peer")
(cd "$B" && node "$CLI" recognize "$A" --note "Newman demo peer")
```

> 💬 "Recognition is *unilateral and signed*. A reads B's published entity
> statement, verifies B's signature, then signs A's own attestation:
> 'I have verified this peer and am willing to engage.'"

**Show this on disk:**

```bash
cat "$A/flyway/peers.yaml"
```

> 💬 "Point at: the `peerPublicKey` inlined here — that's the trust anchor
> for any future signal from B. And the `signature` block at the bottom —
> that's A signing the whole entry under `flyway-v1:recognition` so it
> can't be replayed as anything else."

---

## Beat 2 — A flags a tension (~30 sec)

```bash
TENSION_OUT=$(cd "$A" && node "$CLI" tension "$B" \
  --conditions "Sprint reviews are running 90+ minutes over the planned slot" \
  --effect "Retrospectives are being compressed or skipped" \
  --relevance "Both teams rely on retros to surface cross-circle tensions early")
echo "$TENSION_OUT"
export TID=$(echo "$TENSION_OUT" | awk '/^  id:/{print $2; exit}')
echo "captured TID=$TID"
```

> 💬 "S3 'Navigate via Tension'. A surfaces a situation worth shared attention,
> before any proposal is on the table. The CLI signs an envelope, writes it
> to A's outbox *first* (durable audit trail), then delivers via the local-fs
> transport into B's inbox."

**Show the YAML B just received:**

```bash
cat "$B/flyway/inbox/github.com/xeeban/a/$TID.yaml"
```

> 💬 "Point at: `kind: tension`, the body fields, the `signature` block with
> `domain: flyway-v1:tension`. Different domain than recognition — that's
> the cross-kind replay protection."

---

## Beat 3 — B checks the inbox + acknowledges (~30 sec)

```bash
(cd "$B" && node "$CLI" check)
```

> 💬 "`sig valid` means B independently verified A's signature using the
> *cached* copy of A's DID document — the one B attested to at recognition
> time. No network, no third-party trust."

```bash
(cd "$B" && node "$CLI" respond "$A" --subject-id "$TID" --decision acknowledge)
```

**Quick pause to show the inbox:**

```bash
(cd "$A" && node "$CLI" check)
```

> 💬 "Now A holds B's signed `acknowledge`. The protocol carried a complete
> round-trip — A's tension out, B's response back. Both sides have signed
> records they can audit independently."

**If you only have 3 minutes, stop here.** This is the Tier 3 walkthrough's
endpoint. Otherwise continue.

---

## Beat 4 — A promotes the tension into a proposal (driver stage) (~45 sec)

```bash
P1_OUT=$(cd "$A" && node "$CLI" propose "$B" \
  --type directive \
  --title "Tighten sprint review agenda" \
  --body "Cap reviews at 60 minutes; rotate facilitator weekly" \
  --stage driver \
  --promote-tension-id "$TID")
echo "$P1_OUT"
export PID1=$(echo "$P1_OUT" | awk '/^  id:/{print $2; exit}')
```

> 💬 "A is taking the tension B acknowledged and proposing concrete action.
> Note `--promote-tension-id` — the proposal carries `refs.tensionId` binding
> it back to the original tension. ADR-0009 antecedent verification runs at
> sign time: the prior tension must verify under A's own key before this
> proposal can be signed."

**Show the chain in the YAML:**

```bash
cat "$B/flyway/inbox/github.com/xeeban/a/$PID1.yaml" | grep -A2 refs:
```

> 💬 "`refs.tensionId` is part of the signed payload. Re-pointing it after
> signing breaks the signature."

---

## Beat 5 — B objects with concerns (~30 sec)

```bash
(cd "$B" && node "$CLI" respond "$A" --subject-id "$PID1" \
  --decision object \
  --reason "Need agenda buy-in from team before tightening" \
  --concern "Verify cadence at first review" \
  --concern "Consider async option for EU members")
```

> 💬 "S3 §IV.1.5. `object` blocks consent until integrated, but the
> `--concern` (repeatable) records Step 9 concerns that *don't* block — they
> just become part of the agreement's review log. That's the difference
> between an objection and a concern, made machine-readable."

**Show on disk:**

```bash
(cd "$A" && node "$CLI" check)
```

---

## Beat 6 — A advances to draft (stage transition) (~30 sec)

```bash
P2_OUT=$(cd "$A" && node "$CLI" propose "$B" \
  --type directive \
  --title "Sprint review draft v1" \
  --body "60-min cap; team drafts agenda 24h ahead" \
  --stage draft \
  --previous-stage-id "$PID1")
echo "$P2_OUT"
export PID2=$(echo "$P2_OUT" | awk '/^  id:/{print $2; exit}')
```

> 💬 "Stage transition: driver → draft. The protocol validates this against
> the staging-chain rules in `propose.ts` — `driver → [driver, requirements,
> draft, final]`. Try `--stage refinement` here and it'll refuse, because
> refinement implies a prior draft. The protocol is opinionated about S3."

---

## Beat 7 — B objects again (~20 sec)

```bash
(cd "$B" && node "$CLI" respond "$A" --subject-id "$PID2" \
  --decision object \
  --reason "Agenda needs explicit facilitator rotation policy" \
  --concern "Bake-in rotation: weekly or monthly?")
```

---

## Beat 8 — A integrates the objection into a refinement (~30 sec)

```bash
P3_OUT=$(cd "$A" && node "$CLI" propose "$B" \
  --type directive \
  --title "Sprint review refinement v1" \
  --body "60-min cap; team-drafted agenda 24h ahead; facilitator rotates monthly" \
  --stage refinement \
  --previous-stage-id "$PID2")
echo "$P3_OUT"
export PID3=$(echo "$P3_OUT" | awk '/^  id:/{print $2; exit}')
```

> 💬 "This is the S3 objection-integration step. The objection didn't kill
> the proposal — it made the next version stronger. The protocol kept the
> chain bound: PID3 references PID2 references PID1 references the original
> tension. The whole governance act is one verifiable chain."

---

## Beat 9 — B accepts (~20 sec)

```bash
(cd "$B" && node "$CLI" respond "$A" --subject-id "$PID3" \
  --decision accept \
  --concern "Revisit cadence at month 1 review")
```

> 💬 "Consent reached. B added one concern to record — not blocking, but
> noted for the first review."

---

## Beat 10 — Both sides audit (~30 sec)

```bash
(cd "$A" && node "$CLI" check)
(cd "$B" && node "$CLI" check)
```

> 💬 "Each side has four signed envelopes. A's inbox has B's four responses;
> A's outbox has A's four sent signals. B's inbox has A's three proposals +
> the original tension echo; B's outbox has the four responses B signed.
> Zero issues on either side. Both can audit the entire governance act
> against artifacts they themselves signed or attested to at recognition
> time."

```bash
echo "=== A's outbox files ===" && ls -1 "$A/flyway/outbox/github.com/emergent/praxis/"
echo "=== B's outbox files ===" && ls -1 "$B/flyway/outbox/github.com/xeeban/a/"
```

---

## Cleanup (after the demo)

```bash
rm -rf "$A" "$B"
unset A B CLI TID PID1 PID2 PID3 TENSION_OUT P1_OUT P2_OUT P3_OUT
```

---

## Failure recovery

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `CLI` path "no such file" | build is stale | `pnpm --filter @murmurations-ai/flyway-cli build` |
| `peer X is not recognized` | recognize step skipped | re-run beat 1 |
| `subject signal '…' is from … but peer-repo-path resolves to …` | wrong `$A`/`$B` order | check `echo $A $B` |
| `invalid stage transition` | typo in `--stage` (e.g. `driver → refinement`) | use the canonical chain: driver → draft → refinement → final |
| YAML file empty / missing | local-fs delivery silently lost? unlikely — re-run last command, check `$B/flyway/inbox/` |

---

## Talking points to weave in

When Newman asks "where's the central state?":
> "There isn't any. Every artifact lives in one of the two repos. Each side
> can audit independently against signed records they hold."

When he asks about transport:
> "v0.1 ships local-fs only — both repos on the same machine. ADR-0008
> reserves GitHub-PR and URL-webhook transports for v0.2. The envelope shape
> is transport-agnostic so we don't have to change anything in the senders
> when we add a remote transport."

When he asks about agreements:
> "The proposal carries the structured agreement body. The byte-identical
> co-signed agreement file at `flyway/agreements/<id>.yaml` is S+5b — next
> milestone. The schema is `FLYWAY_AGREEMENT_SCHEMA` already in core, with
> 11 required fields mapped to S3 §IV.7.1."

When he asks about identity rotation:
> "Today: a Source can re-run `init --force`. The new key invalidates prior
> signatures. Peers will detect drift via the cached `peerPublicKey` in
> their recognition entries. Long-term rotation policy is open — ADR-0007
> reserves the seam for HSM / Cardano-resident signers."

When he asks if this would work with non-flyway tools:
> "Yes — the SKILL.md is the canonical interface. Any Agent Skills IO-compatible
> runtime can load it. The MCP server is the same surface for clients that
> speak MCP. The CLI is for human Sources or scripts."

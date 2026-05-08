# Consent mechanisms in flyway

flyway treats the decision rule for any agreement as **pluggable**. The
default is S3 consent (see [`sociocracy-3.md`](./sociocracy-3.md)), but
each engagement agreement between two murmurations can specify a
different rule when the work calls for it.

This document lists the rules flyway supports out of the box.

## Why pluggable?

Different work has different stakes. A typo correction in a shared
document does not warrant the same process as a decision to dissolve a
syndicate.

Different organizations also have different governance traditions.
Pluggability lets murmurations cooperate without demanding cultural
conformity.

The rules below are referenced by id in the agreement YAML file
(`decision_rule: s3-consent`).

## The rules

### `s3-consent` *(default)*

Sociocracy 3.0 consent. Each side runs an S3 consent round; the proposal
passes when no participant raises a qualified objection. Best for
substantive decisions where integration of concerns matters.

See [`sociocracy-3.md`](./sociocracy-3.md) for the full primer.

### `lazy-consent`

Borrowed from the Apache Software Foundation. The proposal is stated; if
no one objects within a defined quiet window (typically 72 hours),
silence is taken as consent. Best for routine matters and well-understood
patterns where requiring active sign-off would be more friction than the
decision warrants.

Reference: <https://www.apache.org/foundation/voting.html>

### `dual-source-sign`

Both Sources must explicitly sign the proposal — typically via a signed
commit on a pull request. No silent consent; no proxy. Best for
high-stakes, irrevocable decisions: dissolving a syndicate, transferring
an agreement, changing the decision rule of an existing agreement.

### `weighted-vote-bounded`

Members get votes weighted by an agreed criterion (contribution, stake,
role), but no single member's weight may exceed a defined cap (typically
40%). Best for asymmetric cooperation where one party has
disproportionate investment but smaller parties still need meaningful
protection.

### `apache-vote`

Apache-style voting: any +1 votes pass; any well-reasoned -1 (with
explanation) blocks. Threshold and quorum are agreement-specific. Best
for open-source-style software collaborations where participants are
already familiar with the convention.

Reference: <https://www.apache.org/foundation/voting.html>

## Selecting a rule

| Situation                                          | Suggested rule          |
| -------------------------------------------------- | ----------------------- |
| Default, when nothing else is specified            | `s3-consent`            |
| Small routine decisions, fast turnaround           | `lazy-consent`          |
| Irrevocable or high-stakes structural decisions    | `dual-source-sign`      |
| Asymmetric contribution but everyone matters       | `weighted-vote-bounded` |
| Open-source software conventions in play           | `apache-vote`           |

The agreement specifies the rule. If an agreement does not specify, S3
consent applies.

## What is *never* pluggable

Regardless of which decision rule an agreement uses, flyway maintains
four invariants:

1. **Source sovereignty.** No rule can force a Source to accept an
   action they reject.
2. **Cryptographic identity.** Every action is signed by some party.
3. **Append-only history.** Decisions, once made, are recorded
   immutably and replayable.
4. **Exit rights.** Every party may exit any agreement at any time,
   subject only to the agreement's transition clause.

These are the substrate. Decision rules ride on top of them, never
underneath.

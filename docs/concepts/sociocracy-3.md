# Sociocracy 3.0 (S3)

flyway uses Sociocracy 3.0 as its default decision-making framework for
cross-murmuration consent. This document is a brief primer and a pointer
to the authoritative material.

## What S3 is

Sociocracy 3.0 (S3) is an open framework of patterns for evolving agile
and resilient organizations of any size. It was developed by **James
Priest, Bernhard Bockelbrink, and Liliana David**, building on classical
Sociocracy (Gerard Endenburg, 1970s onward) and incorporating patterns
from Agile, Lean, and Holacracy.

S3 is published under Creative Commons (CC BY-SA 4.0). There are no
licensing fees, no certifications gatekeepers, and no proprietary
trainers required to use it.

## Key concepts

### Driver

A *driver* is what motivates an action — the situation a person or group
is responding to. S3 starts every proposal by naming the driver, before
any solution is on the table. The discipline of separating "what's
actually happening" from "what we want to do about it" prevents most
solutions-first dysfunction.

### Consent (not consensus)

A decision is made by **consent** when no participant has a *qualified
objection* — a reasoned argument that the proposal would cause meaningful
harm or move the group away from its goal. Consent is not consensus.
The bar is **good enough for now and safe enough to try**, not
"everyone loves it."

### Objection (and integration)

An objection is the protocol's most valuable input. Objections are not
vetoes; they are surfaced concerns that get *integrated* through
revision. The proposer adapts the proposal until the objection is
addressed. This is the heart of S3 — and the reason flyway models its
response cycle on it.

### Agreement

A decision made by consent becomes an *agreement*. Agreements are
explicit, recorded, and reviewable. They have a defined scope and a
review cadence; they are not informal understandings.

### Circle and role

A *circle* is a self-governing team with a domain. A *role* is a position
within a circle with specific responsibilities and decision-making
authority. flyway does not require either at the protocol level, but
participating murmurations may use them internally.

## How flyway uses S3

flyway adopts S3 consent as its default decision rule for cross-murmuration
agreements. When two Sources negotiate an engagement agreement, propose a
project, or change a syndicate's bylaws, S3 consent is the default
mechanism unless the agreement specifies otherwise.

The S3 patterns flyway leans on most directly:

- **Drivers** — proposals start by naming what is motivating them.
- **Objections with reasoning** — `flyway_respond` with `decision: object`
  requires a `reason` field. An unreasoned objection is not a valid
  objection.
- **Integration cycles** — the response cycle (object → revise →
  re-propose) is the protocol's mechanism for *reaching* agreement, not
  a holding pattern.
- **Explicit agreements** — flyway agreements are recorded as artifacts
  in Git. They are not informal understandings.

## Canonical reference

flyway treats one specific document as its canonical S3 reference:

- [`S3-practical-guide.pdf`](./S3-practical-guide.pdf) — Bockelbrink,
  Priest, and David, *A Practical Guide for Evolving Agile and Resilient
  Organizations with Sociocracy 3.0*, v2026-01-26. Bundled in the repo so
  every contributor and agent works from the same edition.

When we build flyway tools, skills, instructions, or governance
primitives that are based on S3, this is the source. It is the
authority; if our description and the guide disagree, the guide wins.

## Where to learn more (external)

- **Official site:** <https://sociocracy30.org/>
- **Patterns library:** <https://patterns.sociocracy30.org/> — browseable
  catalogue of every S3 pattern with examples
- The S3 site also hosts videos, slide decks, and case studies under the
  same open license.

## License and attribution

The S3 Practical Guide and the broader Sociocracy 3.0 framework are
published under **Creative Commons Attribution-ShareAlike 4.0
International (CC BY-SA 4.0)** by James Priest, Bernhard Bockelbrink, and
Liliana David.

flyway is licensed MIT. When flyway artifacts (docs, instructions,
skills) are *derived* from S3 content (e.g., paraphrasing a pattern into
agent instructions), those derivatives must carry CC BY-SA 4.0
attribution and license terms — they are dual-licensed in effect, and
need to be marked as such. Factual references (pattern names, the seven
principles by name, page numbers) are not derivative works and do not
trigger this obligation.

## Why S3 over alternatives

flyway considered several decision frameworks. S3 was chosen as the
default because:

1. It is explicitly open-source, free to use, and free to extend.
2. Its consent mechanism is well-defined and battle-tested across many
   organizations and decades.
3. Its objection-and-integration cycle maps cleanly to async, written,
   cross-organizational work — which is what flyway is.
4. It works at any scale, from two people to large federations.

Other consent mechanisms remain available per agreement —
see [`consent-mechanisms.md`](./consent-mechanisms.md) for the full list
of decision rules flyway supports.

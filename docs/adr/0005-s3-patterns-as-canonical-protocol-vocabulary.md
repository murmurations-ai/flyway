# ADR-0005 — S3 patterns as the canonical protocol vocabulary

- **Status:** Accepted
- **Date:** 2026-05-08
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

ADR-0004 established that the agent skill is the primary protocol interface
and named the eight flyway tools (`flyway_init` through `flyway_exit`). What
ADR-0004 did *not* settle is the *substance* the skill carries: when an
agent reasons about consent, integration, objections, or agreements, what
vocabulary and patterns is it using?

The research paper (§7) named Sociocracy 3.0 consent as flyway's default
decision rule. The concept primer in
[`docs/concepts/sociocracy-3.md`](../concepts/sociocracy-3.md) describes
S3's place in the project. As of 2026-05-08, the canonical S3 reference —
*A Practical Guide for Evolving Agile and Resilient Organizations with
Sociocracy 3.0*, Bockelbrink, Priest, and David, v2026-01-26 — is bundled
in the repo at
[`docs/concepts/S3-practical-guide.pdf`](../concepts/S3-practical-guide.pdf).

The Practical Guide contains roughly 70 named patterns covering
sense-making and decision-making, organizing work, peer development,
defining agreements, meeting formats, and organizational structure. Most
of those patterns describe work that happens *between* humans in
collaboration. flyway's job is to let that work happen *between
murmurations* across organizational boundaries.

We need to decide whether and how those S3 patterns become flyway
artifacts.

## Decision

**S3 is the canonical pattern vocabulary for flyway's consent and
governance surface.** When flyway tools, instructions, or skills speak
about objections, integration, agreements, drivers, requirements, or
related concepts, they will use S3's definitions and citations from the
bundled Practical Guide as the authoritative source.

Adoption proceeds in three phased tiers:

### Tier 1 — Protocol primitives (in `flyway-core`)

Patterns that operate *between sovereign Sources* and therefore belong
in the canonical tool surface or the protocol instructions every agent
loads at runtime. Tier 1 is the immediate next implementation milestone.
Its scope is:

| S3 pattern (§ in Practical Guide)                       | flyway artifact                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Consent Decision-Making (§IV.1.5)                       | Already aligned with `flyway_propose` + `flyway_respond` cycle; instructions cite by name    |
| Resolve Objections (§IV.1.7)                            | Already aligned with `decision: object`; instructions describe the integration cycle by name |
| Test if Arguments Qualify as Objections (§IV.1.6)       | Added to protocol instructions so agents can evaluate concerns honestly                      |
| Navigate via Tension (§IV.1.2)                          | New first-class shape — either a new tool or a structured mode of `flyway_propose` (TBD)     |
| Co-Create Proposals + Proposal Forming (§IV.1.9–1.10)   | Augments `flyway_propose` with explicit stages (driver, requirements, draft, refinement)     |
| Contract for Successful Collaboration (§IV.7.1)         | Shapes the schema for agreements created via `flyway_propose` with `type: agreement`         |
| Record Governance Decisions + Logbook (§IV.7.2, §IV.7.5)| Shapes how flyway records agreements and decisions in the participating repos                |

### Tier 2 — Agent skills (in `flyway-agent`)

S3 patterns useful as *agent-loadable knowledge* but not protocol
operations. Distributed as additional content in the flyway agent skill —
either inline in `SKILL.md`, in the `references/` directory, or as
sibling Agent Skills IO skills. Loaded progressively when an agent is
working on the relevant kind of task. Tier 2 candidates include:

- The Seven Principles of S3 (Part II) — Effectiveness, Consent,
  Empiricism, Continuous Improvement, Equivalence, Transparency,
  Accountability. Read at skill-load time.
- Meeting Practices (§IV.9): Rounds, Check In, Facilitate Meetings,
  Evaluate Meetings.
- Peer Development (§IV.3): Ask for Help, Peer Feedback, Peer Review,
  Development Plan.
- Enablers of Co-Creation (§IV.4): Agree On Values, Involve Those
  Affected, Invest in Ongoing Learning, Breaking Agreements.

### Tier 3 — Reference (in `docs/concepts/`)

Patterns about internal organizational structure, useful for Sources
who run sociocratic murmurations but not protocol concerns. Stay as
human-readable reference; not loaded into the agent skill. Includes:

- Building Organizations (§IV.5): Circle, Role, Linking, Double Linking,
  Representative, Delegate Circle, Service Circle, Open Team, Helping Team.
- Organizational Structure (Part V): Peach, Double-Linked Hierarchy,
  Service, Fractal.
- Bringing in S3 (§IV.6): Create a Pull System for Organizational Change,
  Adapt Patterns to Context, Be the Change, Invite Change.

## Consequences

**Positive:**

- The protocol speaks a defined vocabulary instead of one we invent. When
  an agent reads "object with reason" in flyway's instructions, the
  reasoning is grounded in a documented S3 pattern, not in our intuition.
- Interoperability cost is low for any human or murmuration that already
  works with S3. They recognize the vocabulary; the tools fit existing
  practice.
- The patterns are battle-tested. We do not have to design objection
  resolution, proposal forming, or agreement structure from scratch — S3
  has done that work.
- Phased tiering keeps Tier 1 small and shippable while preserving the
  larger ambition.

**Negative:**

- The protocol's internal vocabulary becomes coupled to one school of
  practice. Murmurations that prefer different governance traditions can
  still participate (per ADR — pluggable decision rules in
  `consent-mechanisms.md`), but the *defaults* and the agent's reasoning
  defaults will be S3-flavored.
- Updating to a new S3 edition requires diffing patterns and updating
  flyway artifacts. Manageable; the canonical reference is one PDF.
- License complexity. S3 is CC BY-SA 4.0; flyway is MIT. Tier 1 and Tier 2
  artifacts that paraphrase or extract pattern content are derivative
  works and must carry CC BY-SA attribution; pattern names and factual
  citations alone do not. The repo will need to mark S3-derivative content
  explicitly.

**Reversibility:** medium. Removing S3-specific vocabulary from the
protocol after agents and tools depend on it is a breaking change. Adding
parallel vocabulary from another tradition (e.g., Holacracy, Apache
voting) is straightforward — the pluggable decision-rule framework
already supports it.

## Phasing and acceptance

This ADR records the architectural decision (S3 is canonical; three-tier
adoption) and the Tier 1 scope. The actual Tier 1 work — modifying tool
descriptions, enriching protocol instructions with S3 citations, defining
agreement schemas based on Contract for Successful Collaboration, and
deciding the Navigate via Tension shape — is the next implementation
milestone after this ADR is accepted.

Tier 2 and Tier 3 are explicitly future work. Each gets its own milestone
when the prerequisites are in place. New ADRs may follow if those tiers
introduce architectural changes (e.g., a separate Agent Skills IO skill
for meeting practices would be an architectural choice worth recording).

## License and attribution

The bundled S3 Practical Guide is © James Priest, Bernhard Bockelbrink,
and Liliana David, licensed CC BY-SA 4.0. flyway artifacts that derive
from S3 content (paraphrased patterns, S3-grounded protocol instructions,
S3-shaped agreement schemas) carry CC BY-SA 4.0 attribution alongside
flyway's MIT license. The conventions for marking such content are:

- Source files derived from S3 carry a comment block at the top citing
  the pattern name, section reference (e.g. `§IV.1.5`), authors, and
  CC BY-SA 4.0 license.
- README and concept docs that paraphrase S3 content carry a footer
  attribution.
- Pattern names alone, factual references, and brief illustrative quotes
  used with attribution do not require dual-licensing the surrounding
  flyway content.

## Alternatives considered

1. **Invent flyway's own consent vocabulary.** Rejected. The research
   paper already named S3 as the default, and reinventing what S3 has
   already documented carefully would produce a worse, less-tested
   protocol. The "small protocol, strong conventions" principle from
   ADR-0001 favors borrowing the convention.

2. **Adopt S3 patterns wholesale and immediately, without tiering.** A
   one-shot extraction of all 70+ patterns into flyway artifacts.
   Rejected as too large a unit of work and likely to bloat the agent
   skill past the Agent Skills IO 5,000-token guidance for `SKILL.md`
   body content (per the spec). The tiered approach respects progressive
   disclosure: only what's needed at the protocol level is loaded by
   default; the rest is referenceable.

3. **Use the S3 patterns library website as canonical source instead of
   the PDF.** Rejected. The website may evolve continuously; bundling a
   specific PDF version makes the source authoritative and reproducible.
   Updating to a newer edition becomes an explicit, versioned act.

## Links

- [ADR-0001](./0001-project-framing-and-scope.md) — runtime independence;
  "small protocol, strong conventions"
- [ADR-0004](./0004-agent-skill-as-primary-protocol-interface.md) — the
  agent skill is the protocol surface; this ADR decides what fills it
- [`docs/concepts/sociocracy-3.md`](../concepts/sociocracy-3.md) — S3 primer
- [`docs/concepts/consent-mechanisms.md`](../concepts/consent-mechanisms.md) —
  the five decision rules and the four invariants
- [`docs/concepts/S3-practical-guide.pdf`](../concepts/S3-practical-guide.pdf) —
  canonical source (Bockelbrink, Priest, David, v2026-01-26)
- Research paper §7 — original framing of S3 as default decision rule

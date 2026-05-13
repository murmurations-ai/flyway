# Architecture Decision Records

This directory holds the ADR log for the flyway project.

## Format

We use a lightweight [MADR](https://adr.github.io/madr/)-inspired template (mirrored from `murmurations-ai/murmurations-harness`):

```markdown
# ADR-NNNN — Title

- **Status:** Proposed | Accepted | Superseded by ADR-MMMM | Deprecated
- **Date:** YYYY-MM-DD
- **Decision-maker(s):** Source (Nori / Kozan), Agent #N
- **Consulted:** Agent #K (non-blocking input)

## Context

What is the forcing function? What constraints are in play?

## Decision

What we are actually doing.

## Consequences

What this makes easier, what it makes harder, and the reversibility
cost if we need to undo it.

## Alternatives considered

What else we looked at and why we chose this instead.
```

## Numbering

Numbers are monotonically increasing and never reused. If an ADR is
superseded, update its `Status` field to point at the successor; do
not delete or renumber.

**Before authoring a new ADR**, an author (human or agent) MUST:

1. Read this index and skim filenames in `docs/adr/` to confirm no
   existing ADR already covers the topic. If one does, propose an
   amendment or a successor that explicitly supersedes it — do not
   start a fresh ADR on the same decision.
2. Pick the next number as `max(existing_number) + 1`.
3. If the topic appears in a project plan or roadmap, link to it
   from the new ADR.

This rule is mirrored from the harness (where it was added 2026-04-27
after parallel autonomous wakes of the same agent independently
authored 13 colliding ADRs at numbers already in use).

## Index

| #                                                                              | Title                                                              | Status   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| [ADR-0001](./0001-project-framing-and-scope.md)                                | Project framing & scope                                            | Accepted |
| [ADR-0002](./0002-typescript-as-implementation-language.md)                    | TypeScript as implementation language                              | Accepted |
| [ADR-0003](./0003-monorepo-layout.md)                                          | Monorepo layout                                                    | Accepted |
| [ADR-0004](./0004-agent-skill-as-primary-protocol-interface.md)                | Agent skill as the primary protocol interface                      | Accepted |
| [ADR-0005](./0005-s3-patterns-as-canonical-protocol-vocabulary.md)             | S3 patterns as the canonical protocol vocabulary                   | Accepted |
| [ADR-0006](./0006-skill-distribution-and-installation.md)                      | Skill distribution and installation                                | Proposed |

# Concepts

This directory contains foundational primers on the concepts flyway relies
on. These are curated reading for anyone who wants to understand *why*
flyway is shaped the way it is. They differ from the material in
[`../research/`](../research/), which captures pre-implementation research
and synthesis — these documents are conceptual reference, not research
output.

## Documents

- [`defining-source.md`](./defining-source.md) — what we mean by "Source"
  (Peter Koenig and Tom Nixon's work)
- [`sociocracy-3.md`](./sociocracy-3.md) — primer on Sociocracy 3.0,
  flyway's default decision-making framework
- [`consent-mechanisms.md`](./consent-mechanisms.md) — the five decision
  rules flyway supports for engagement agreements

## How these relate to the project

flyway's design choices follow directly from these conceptual foundations:

- The **Source concept** (Koenig / Nixon) is why flyway anchors identity at
  the human Source rather than at an agent, a runtime, or an installation.
- **S3 consent** is why the protocol's response cycle is built around
  proposals, named objections with reasoning, and integration.
- **Pluggable decision rules** are why agreements can specify different
  consent mechanisms for different kinds of work.

If you're new to any of these concepts, read the relevant primer here
before working through the ADRs or the research synthesis.

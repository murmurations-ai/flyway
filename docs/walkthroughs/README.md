# Walkthroughs

End-to-end traces of the flyway protocol exercised by independent agents
against a real scenario. Each walkthrough is **tied to a specific code
version** via git SHA and protocol version, so progress over time is
auditable: we can see exactly what protocol surface was tested, what worked,
and what gaps surfaced.

Walkthroughs are evidence, not specification. They are how we know whether
the protocol — as currently coded — can carry a real cross-murmuration
negotiation from tension to consent. They also surface gaps that get filed
as GitHub issues.

## Index

| Date       | Walkthrough                                                                     | Protocol | Code SHA  | Outcome                                                                 |
| ---------- | ------------------------------------------------------------------------------- | -------- | --------- | ----------------------------------------------------------------------- |
| 2026-05-13 | [3-party retrospective cadence](./2026-05-13-3party-retrospective-cadence.md)   | 0.1.0    | `02e1bfa` | Consent reached after one objection-integration cycle. 8 gaps surfaced. |

## Structure of a walkthrough

Each walkthrough captures:

1. **Setup** — the scenario, the participating murmurations, the tension or
   driver being addressed.
2. **Tool-call traces** — the actual JSON inputs from each agent, in order.
3. **Facilitator integrations** — synthesis of independent responses.
4. **Outcome** — consent reached, exit declared, or stuck.
5. **Gaps surfaced** — what the test revealed about the protocol, filed as
   GitHub issues.

## How to add a new walkthrough

1. Run a scenario end-to-end (typically with subagents reasoning independently
   from distinct murmuration contexts).
2. Capture every tool-call input and the facilitator's integrations.
3. Note the current `FLYWAY_PROTOCOL_VERSION` and the git SHA you tested at.
4. Write up the walkthrough following the structure above.
5. File issues for any gaps the scenario surfaced; link them in the
   walkthrough's "Gaps surfaced" section.
6. Add the row to the index table.

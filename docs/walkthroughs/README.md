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

| Date       | Walkthrough                                                                     | Kind         | Protocol | Code SHA  | Outcome                                                                                |
| ---------- | ------------------------------------------------------------------------------- | ------------ | -------- | --------- | -------------------------------------------------------------------------------------- |
| 2026-05-13 | [3-party retrospective cadence](./2026-05-13-3party-retrospective-cadence.md)   | narrative    | 0.1.0    | `02e1bfa` | Consent reached after one objection-integration cycle. 8 gaps surfaced.                |
| 2026-05-21 | [Tier 1 — mutual recognition](./2026-05-21-tier1-mutual-recognition.md)         | executable   | 0.1.0    | `1712232` | Two murmurations mutually recognize each other with verified signatures. 3 new gaps.   |
| 2026-05-25 | [Tier 2 — first signal exchange](./2026-05-25-tier2-signal-exchange.md)         | executable   | 0.1.0    | `bfaf1db` | A signed tension envelope crosses A → B; B's flyway_check verifies it. 3 new gaps.     |
| 2026-05-25 | [Tier 3 — first signal dialogue](./2026-05-25-tier3-signal-dialogue.md)         | executable   | 0.1.0    | `64b112a` | Full A↔B round-trip — tension + acknowledge, both sides hold signed records. 3 new gaps. |

## Two kinds of walkthrough

- **Narrative** — subagents reason from distinct murmuration contexts about
  a protocol that may not yet execute. Surfaces gaps in protocol *design*.
  Example: 2026-05-13.
- **Executable** — real code runs end-to-end against real on-disk artifacts
  with real signatures. Surfaces gaps in protocol *implementation* and gives
  reproducible empirical evidence the system does what it claims. Example:
  2026-05-21.

Both kinds are valuable. Narrative walkthroughs are cheaper to write and can
test the surface before any code exists. Executable walkthroughs are the
only thing that proves the code matches the design.

## Structure of a walkthrough

Each walkthrough captures:

1. **Setup** — the scenario, the participating murmurations, the tension or
   driver being addressed.
2. **Tool-call traces** — the actual inputs from each agent (narrative) or
   the actual CLI/MCP invocations with their output (executable), in order.
3. **Facilitator integrations** — synthesis of independent responses
   (narrative only).
4. **Outcome** — consent reached, exit declared, mutual recognition
   established, or stuck.
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

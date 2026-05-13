# Retrospectives

Honest looks back at build cycles — what shipped, what worked, what still
needs work, what patterns emerged, what to do next. Each retrospective is
tied to a specific git SHA and protocol version so progress is measurable
against the prior look.

Retrospectives are written at the end of meaningful work cycles (a
completed tier, a major refactor, a deployable release), not on a fixed
calendar. They are *evidence about the build process itself*, the way
[walkthroughs](../walkthroughs/) are evidence about the protocol surface.

## Index

| Date       | Cycle                                                                      | Protocol | Code SHA  |
| ---------- | -------------------------------------------------------------------------- | -------- | --------- |
| 2026-05-13 | [First build cycle](./2026-05-13-first-build-cycle.md) — research → Tier 1 | 0.1.0    | `12f48e4` |

## Structure of a retrospective

1. **What we shipped** — the concrete artifacts.
2. **What's working well** — patterns, decisions, and surfaces that produced value, with examples.
3. **What still needs work** — honest gaps, ranked by severity.
4. **Patterns observed** — meta-observations about how the work itself went.
5. **Recommendations forward** — prioritized next moves.

Retrospectives should be *honest*, not promotional. Surface the failures
and frictions as clearly as the wins. They are written for the future
contributor (often future-you) trying to understand why the system is
shaped the way it is and what to fix.

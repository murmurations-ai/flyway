# ADR-0006 — Skill distribution and installation

- **Status:** Accepted
- **Date:** 2026-05-13
- **Decision-maker(s):** Source (Nori / Kozan)
- **Consulted:** —

## Context

[ADR-0004](./0004-agent-skill-as-primary-protocol-interface.md) made the
agent skill the primary protocol interface. The flyway skill (currently
named `flyway`, in `@murmurations-ai/flyway-agent`) is grounded in
Sociocracy 3.0 per
[ADR-0005](./0005-s3-patterns-as-canonical-protocol-vocabulary.md).
ADR-0005's Tier 2 explicitly anticipates *more* skills — the Seven
Principles, Meeting Practices, Peer Development — each likely shipping
as its own Agent Skills IO artifact.

The retrospective at SHA `12f48e4` named gap #6 directly: skills are
TypeScript constants today, not installable into any agent environment.
The Agent Skills IO spec says a skill is a folder containing `SKILL.md`
(plus optional `scripts/`, `references/`, `assets/`) at a known
location. Each agent runtime has its own convention for where skill
folders live — Claude Code uses `.claude/skills/<name>/`, others
differ.

We need to decide how skills move from "exported by a package" to
"installed in an environment," and we need that decision to scale to
multiple skills (current and future) without ad-hoc duplication.

## Decision

**Skills are installable artifacts distributed as npm packages and
installed via the flyway CLI.**

### Installation surface

1. **Each skill package exports its content as constants.** For example,
   `@murmurations-ai/flyway-agent` exports `FLYWAY_SKILL_MD`. This is
   the existing pattern; it does not change.

2. **`@murmurations-ai/flyway-cli` owns the install verb**, with
   subcommands:

   | Command                                 | Behaviour                                                       |
   | --------------------------------------- | --------------------------------------------------------------- |
   | `flyway skill list`                     | Show available skills and their installed/not-installed status  |
   | `flyway skill install <name> [--target <path>]` | Write a skill's Agent Skills IO folder to the target    |
   | `flyway skill uninstall <name> [--target <path>]` | Remove a skill folder                                 |

3. **Target resolution.** If `--target` is omitted, the CLI infers from
   environment markers in cwd:
   - `.claude/` present → `.claude/skills/`
   - `.cursor/` present → `.cursor/skills/` (when Cursor's convention
     is known)
   - Otherwise prompt; if non-interactive, default to `./skills/` and
     print a notice.

   Explicit `--target` always wins.

4. **Installation produces a spec-compliant folder.** Per Agent Skills
   IO §Directory structure:

   ```
   <target>/<skill-name>/
   ├── SKILL.md
   ├── scripts/           (present only when the skill ships scripts)
   ├── references/        (present only when the skill ships references)
   └── assets/            (present only when the skill ships assets)
   ```

5. **The CLI imports skill content from skill packages**, never
   hardcodes it. Adding a new skill is: publish a package that exports
   skill content, register it in the CLI's skill registry, ship. The
   CLI stays thin; the content lives where it belongs.

### Scope for the first implementation

- Only `flyway-agent` is registered. One skill, named `flyway`.
- Only `SKILL.md` is written. No `scripts/`, `references/`, or
  `assets/` subdirs until those exist on a real skill.
- Target inference covers Claude Code (`.claude/skills/`); other
  runtimes get explicit-`--target` initially.
- `flyway skill update` is **out of scope** for v0.1 — re-running
  `install` overwrites with a warning if local content differs from
  what's about to be written.
- No content-hash safety yet. We will add it before any user-modifiable
  scripts/ subdirs ship.

When Tier 2 lands (Seven Principles, Meeting Practices, Peer
Development per ADR-0005), each becomes its own package and gets
registered with the CLI. The install surface does not change.

### Naming convention

Skill names follow Agent Skills IO spec (lowercase, hyphens, no
leading/trailing hyphens, no consecutive hyphens). The canonical flyway
skill is named `flyway` — parent directory and `SKILL.md`'s `name`
frontmatter field match per spec.

Future skills shipped under our scope adopt the `flyway-` prefix as a
namespace:

- `flyway-facilitator` (if issue #4 produces a separate facilitator skill)
- `flyway-meeting-practices`
- `flyway-peer-development`

The prefix is convention, not requirement. Third-party skills built on
flyway primitives do not need to use it.

## Consequences

**Positive:**

- Closes retrospective gap #6: skills become installable artifacts, not
  just exported constants.
- `flyway-cli` gets its first real job. It stops being a stub.
- Installation logic centralizes in one place; each skill package stays
  focused on content.
- Multiple skills coexist in a single environment with the
  one-folder-per-skill structure the Agent Skills IO spec already
  prescribes.
- Operation is reversible (`uninstall`); users are not trapped.
- Works in the workspace before npm publication —
  `pnpm -F @murmurations-ai/flyway-cli build && node packages/cli/dist/bin/flyway.js skill install flyway`
  installs from a local checkout today.

**Negative:**

- The CLI must know about every skill it can install (a registry).
  Adding a skill is a CLI change. We accept this for v0.1; dynamic
  resolution (manifest-driven, queryable) is a later step worth its
  own ADR if and when third-party skills emerge.
- Version coordination: if `flyway-cli` is at v0.3 but the user has
  `flyway-agent` at v0.5, the CLI may not know about new skills or may
  install outdated content. Standard npm version pinning applies;
  documentation should call this out.
- Target inference can be wrong. Documented; explicit `--target`
  always works.

**Reversibility:** medium-high. The CLI is internal infrastructure;
changing the install surface later (registry format, additional
subcommands, scope-aware install) is mechanical. The decision to make
skills installable *at all* is irreversible in spirit — once users
exist, taking it away is breaking.

## Alternatives considered

1. **Postinstall script in `flyway-agent` that auto-writes `SKILL.md`
   to a guessed location.** Rejected because many consumers will
   install `flyway-agent` for programmatic access (importing
   `FLYWAY_SKILL_MD` into their own tooling) and do not want files
   written to their filesystem as a side-effect of `npm install`.
   Surprising behaviour.

2. **Per-skill installer — each skill package ships its own bin
   (`npx @murmurations-ai/flyway-agent install`).** Rejected because:
   (a) it duplicates installation logic across N skill packages,
   (b) it scatters "what is installed where" knowledge across N entry
   points instead of centralizing it,
   (c) `flyway-cli` already exists and needs a job.

3. **Pre-built tarballs hosted on GitHub releases, installed via
   `curl | tar`.** Rejected as heavier infrastructure than warranted.
   npm is the obvious distribution channel for TypeScript packages and
   we are not exposing this to non-Node users.

4. **A manifest-based registry hosted online that the CLI queries for
   available skills.** Premature; we have one skill. Revisit when there
   are 5+ skills or third-party authors emerge — its own ADR at that
   point.

## Links

- [ADR-0004](./0004-agent-skill-as-primary-protocol-interface.md) — agent skill as primary protocol interface
- [ADR-0005](./0005-s3-patterns-as-canonical-protocol-vocabulary.md) — three-tier S3 adoption plan; Tier 2 produces additional skills
- [docs/retrospectives/2026-05-13-first-build-cycle.md](../retrospectives/2026-05-13-first-build-cycle.md) — gap #6 names the unfilled installation surface
- [Agent Skills IO specification](https://agentskills.io/specification) — canonical format for installed skill folders
- [Issue #4](https://github.com/murmurations-ai/flyway/issues/4) — facilitator role; may produce a separate installable skill

#!/usr/bin/env node
import {
  EXIT_TARGET_TYPES,
  type ExitTargetType,
  FLYWAY_PROTOCOL_VERSION,
  type FlywayMode,
  PROPOSAL_DECISIONS,
  type ProposalDecision,
  type ProposalBody,
  type ProposalRequirement,
  type ProposalStage,
  PROPOSAL_STAGES,
  PROPOSAL_TYPES,
  type ProposalType,
  TENSION_DECISIONS,
  type TensionDecision,
  type DeliveryReceipt,
  type SignalTransport,
  createGithubPrTransport,
  flywayCheck,
  flywayStatus,
} from '@murmurations-ai/flyway-core'
import { runDiscover } from '../discover.js'
import { runExit } from '../exit.js'
import { runInit } from '../init.js'
import { runMaterialize } from '../materialize.js'
import { runPropose } from '../propose.js'
import { runRecognize } from '../recognize.js'
import { runRespond } from '../respond.js'
import { runTension } from '../tension.js'
import { runUnrecognize } from '../unrecognize.js'
import { inferTarget, installSkill, listSkills, SKILL_REGISTRY, uninstallSkill } from '../skill.js'

const HELP = `flyway — runtime-agnostic protocol for cross-murmuration collaboration

Usage:
  flyway <command> [options]

Commands:
  init --repo-url <url> --source-name <name> [--mode MODE] [--force]
                                      Initialize a flyway identity in cwd
                                      (writes .well-known/did.json,
                                      flyway/entity-statement.json,
                                      flyway/keys/source.key; updates .gitignore)

  status [--json]                     Report local flyway state: identity,
                                      signature validity, peers, agreements.

  recognize <peer-repo-path | did:web:...> [--note "..."]
            [--branch main] [--allow-private-host] [--force]
                                      Verify a peer's identity and add a
                                      signed recognition entry to
                                      flyway/peers.yaml. The argument is a
                                      local repo path, or a did:web:… that is
                                      resolved over HTTPS (github.com peers
                                      via raw.githubusercontent; --branch
                                      selects the ref, default main;
                                      --allow-private-host relaxes the SSRF
                                      guard for local testing).

  unrecognize <peer-did> [--reason "..."]
                                      Withdraw recognition of a peer.
                                      Writes a signed unrecognition record
                                      to flyway/unrecognized/ and removes
                                      the entry from flyway/peers.yaml.

  check [--json]                      Inspect flyway/inbox/ and report
                                      signals received from peers, with
                                      per-signal signature validity.

  tension <peer-repo-path> --conditions "..." --effect "..."
          [--relevance "..."] [--proposed-owner "<did>"]
          [--transport <local-fs|github-pr>]
                                      Flag a tension to a recognized peer
                                      (S3 Navigate via Tension). Signs an
                                      envelope, writes it to your outbox,
                                      and delivers it to the peer's inbox.
                                      --transport github-pr opens a PR against
                                      the peer's repo instead of writing their
                                      tree (ADR-0012); local-fs is the default.
                                      Shared by respond / propose / exit.

  respond <peer-repo-path> --subject-id <id> --decision <d>
          [--reason "..."] [--transfer-to "<did>"]
          [--concern "..." ...]
                                      Respond to an incoming tension or
                                      proposal from a peer.
                                      Tension decisions:  acknowledge |
                                      dispute | dissolve | transfer.
                                      Proposal decisions: accept |
                                      object | exit.
                                      --concern (repeatable) records an
                                      S3 §IV.1.5 Step 9 concern alongside
                                      a proposal accept/object.

  propose <peer-repo-path> --type <directive|project|agreement>
          --title "..." --body "..."
          [--stage <driver|requirements|draft|refinement|final>]
          [--previous-stage-id <id>] [--promote-tension-id <id>]
          [--deadline <ISO 8601>]
          [--agreement-file <path>] [--requirements-file <path>]
                                      Propose a directive, project, or
                                      engagement agreement to a recognized
                                      peer. Stage defaults to 'final'.
                                      For type=agreement, --agreement-file
                                      points at a YAML/JSON file conforming
                                      to FLYWAY_AGREEMENT_SCHEMA. For
                                      stage=requirements,
                                      --requirements-file points at a
                                      YAML/JSON list of
                                      {id,description,mustOrShould?,rationale?}.

  discover --directory <path-or-url> [query] [--json]
           [--allow-private-directory]
                                      Search a flyway directory for potential
                                      peers. query may be free text (matches
                                      name / capabilities / description) or a
                                      full did:… for an exact lookup; omit it
                                      to list every entry. Discovery is
                                      read-only and pre-trust — verify at
                                      recognition. --directory takes a local
                                      file (YAML/JSON) or an https:// URL;
                                      remote fetch is HTTPS-only and refuses
                                      private/loopback hosts unless
                                      --allow-private-directory is set.

  exit <peer-repo-path> --target-type <peer|project|syndicate>
       [--target <id>] [--reason "..."]
                                      Leave a peer relationship, project, or
                                      syndicate cleanly. Exit is always valid;
                                      no peer can prevent it. Signs an exit
                                      record, writes it to your outbox, and
                                      delivers it to the peer's inbox. For
                                      --target-type peer, --target defaults to
                                      the resolved peer DID. Exit does not
                                      retract recognition or edit signed
                                      agreement files.

  materialize <peer-repo-path> --response-id <id> [--proposal-id <id>]
                                      Write the co-signed agreement file
                                      flyway/agreements/<id>.yaml from an
                                      accepted final-stage agreement
                                      proposal. Both participants run this
                                      in their own repos; the files are
                                      byte-identical (compare the printed
                                      sha256). --proposal-id defaults to
                                      the response's refs.proposalId.

  skill list                          List available and installed skills
  skill install <name> [--target P]   Install a skill to target directory
  skill uninstall <name> [--target P] Remove a skill from target directory

Options:
  --version, -v   Show flyway protocol version
  --help, -h      Show this help

Examples:
  flyway init --repo-url https://github.com/xeeban/flyway --source-name "Nori"
  flyway skill list
  flyway skill install flyway

For init, mode defaults to 'interactive'. Valid modes: persistent, interactive,
async, ephemeral. See docs/concepts/defining-source.md for what mode means.

If skill --target is omitted, flyway infers the target from the current
directory: .claude/skills/ if a .claude/ directory exists; ./skills/ otherwise.

More: https://github.com/murmurations-ai/flyway
`

const VALID_MODES: readonly FlywayMode[] = ['persistent', 'interactive', 'async', 'ephemeral']

function parseFlag(args: string[], flag: string): { value: string | undefined; rest: string[] } {
  const idx = args.indexOf(flag)
  if (idx === -1) return { value: undefined, rest: args }
  const value = args[idx + 1]
  return { value, rest: [...args.slice(0, idx), ...args.slice(idx + 2)] }
}

function handleSkillCommand(args: string[]): number {
  const [subcommand, ...rest] = args
  switch (subcommand) {
    case 'list': {
      const { target, reason } = inferTarget()
      process.stdout.write(`Target: ${target}  (${reason})\n\n`)
      const statuses = listSkills(target)
      for (const status of statuses) {
        const state = status.installedPath
          ? status.hasLocalChanges
            ? 'installed (modified)'
            : 'installed'
          : 'not installed'
        process.stdout.write(`  ${status.name}  v${status.version}  [${state}]\n`)
        process.stdout.write(`    ${status.description}\n`)
      }
      return 0
    }

    case 'install': {
      const { value: explicitTarget, rest: positional } = parseFlag(rest, '--target')
      const [name] = positional
      if (!name) {
        process.stderr.write('error: flyway skill install requires a skill name\n')
        process.stderr.write(`available skills: ${Object.keys(SKILL_REGISTRY).join(', ')}\n`)
        return 2
      }
      const target = explicitTarget ?? inferTarget().target
      try {
        const { skillPath, warnings, filesWritten } = installSkill(name, target)
        process.stdout.write(`Installed ${name} → ${skillPath}\n`)
        for (const file of filesWritten) {
          process.stdout.write(`  wrote ${file}\n`)
        }
        for (const warning of warnings) {
          process.stderr.write(`warning: ${warning}\n`)
        }
        return 0
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`)
        return 1
      }
    }

    case 'uninstall': {
      const { value: explicitTarget, rest: positional } = parseFlag(rest, '--target')
      const [name] = positional
      if (!name) {
        process.stderr.write('error: flyway skill uninstall requires a skill name\n')
        return 2
      }
      const target = explicitTarget ?? inferTarget().target
      try {
        const { skillPath, existed } = uninstallSkill(name, target)
        if (existed) {
          process.stdout.write(`Uninstalled ${name} (removed ${skillPath})\n`)
        } else {
          process.stdout.write(`${name} was not installed at ${skillPath}\n`)
        }
        return 0
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`)
        return 1
      }
    }

    default:
      process.stderr.write(`error: unknown skill subcommand: ${subcommand ?? '(none)'}\n\n`)
      process.stderr.write(HELP)
      return 2
  }
}

function parseBoolFlag(args: string[], flag: string): { present: boolean; rest: string[] } {
  const idx = args.indexOf(flag)
  if (idx === -1) return { present: false, rest: args }
  return { present: true, rest: [...args.slice(0, idx), ...args.slice(idx + 1)] }
}

/**
 * Parse `--transport <local-fs|github-pr>` shared by the four senders
 * (tension / respond / propose / exit). Defaults to local-fs. `error` is set
 * (and the caller should exit 2) for an unknown transport name.
 */
function parseTransportFlag(args: string[]): {
  transport?: SignalTransport
  rest: string[]
  error?: string
} {
  const { value, rest } = parseFlag(args, '--transport')
  if (value === undefined || value === 'local-fs') return { rest }
  if (value === 'github-pr') return { transport: createGithubPrTransport(), rest }
  return { rest, error: `--transport must be local-fs or github-pr (got: ${value})` }
}

/** One-line delivery status honouring the transport (local write vs offered PR). */
function formatDelivery(receipt: DeliveryReceipt): string {
  if (receipt.transport === 'github-pr') {
    return receipt.delivered
      ? `  offered   ${receipt.ref ?? '(pr)'} — recipient merges to accept\n`
      : `  recorded  outbox only — ${receipt.detail ?? 'not delivered'}\n`
  }
  return `  delivered ${receipt.ref ?? ''}\n`
}

async function handleInitCommand(args: string[]): Promise<number> {
  const { value: repoUrl, rest: r1 } = parseFlag(args, '--repo-url')
  const { value: sourceName, rest: r2 } = parseFlag(r1, '--source-name')
  const { value: modeRaw, rest: r3 } = parseFlag(r2, '--mode')
  const { present: force } = parseBoolFlag(r3, '--force')

  if (!repoUrl || !sourceName) {
    process.stderr.write('error: flyway init requires --repo-url and --source-name\n\n')
    process.stderr.write(HELP)
    return 2
  }

  const mode: FlywayMode = (modeRaw as FlywayMode | undefined) ?? 'interactive'
  if (!VALID_MODES.includes(mode)) {
    process.stderr.write(`error: --mode must be one of ${VALID_MODES.join(', ')} (got: ${mode})\n`)
    return 2
  }

  try {
    const result = await runInit({
      repoUrl,
      sourceName,
      mode,
      cwd: process.cwd(),
      force,
    })
    process.stdout.write(`Initialized flyway identity: ${result.did}\n`)
    for (const file of result.filesWritten) {
      process.stdout.write(`  wrote ${file}\n`)
    }
    if (result.gitignoreUpdated) {
      process.stdout.write('  updated .gitignore to exclude flyway/keys/\n')
    }
    process.stdout.write(
      '\nKeep flyway/keys/source.key private. It is the only material that ' +
        'proves\nyou are the Source of this murmuration.\n',
    )
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleStatusCommand(args: string[]): Promise<number> {
  const { present: asJson } = parseBoolFlag(args, '--json')
  try {
    const status = await flywayStatus(process.cwd())
    if (asJson) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n')
      return 0
    }
    const { identity, peers, agreements, inbox } = status
    const head = identity.initialized
      ? `Identity: ${String(identity.did)}  (signature ${identity.signatureValid ? 'valid' : 'INVALID'})`
      : 'Identity: not initialized'
    process.stdout.write(head + '\n')
    if (identity.initialized) {
      process.stdout.write(`  Source:   ${String(identity.sourceName)}\n`)
      process.stdout.write(`  Mode:     ${String(identity.mode)}\n`)
    }
    for (const issue of identity.issues) {
      process.stdout.write(`  ! ${issue}\n`)
    }
    process.stdout.write(
      `\nPeers:    ${peers.present ? `${String(peers.count)} recognized` : 'no peers file yet'}\n`,
    )
    for (const peer of peers.entries) {
      const sig = peer.recognitionValid ? 'sig valid' : 'sig INVALID'
      const closed = peer.closure
        ? ` — CLOSED (${peer.closure.direction === 'we-exited' ? 'we exited' : 'peer exited'}` +
          `${peer.closure.reason ? `: ${peer.closure.reason}` : ''})`
        : ''
      process.stdout.write(`  - ${peer.sourceName} (${peer.did}) — ${sig}${closed}\n`)
    }
    process.stdout.write(
      `\nAgreements: ${String(agreements.count)} on file` +
        (agreements.closedCount > 0 ? `, ${String(agreements.closedCount)} closed` : '') +
        '\n',
    )
    for (const a of agreements.entries) {
      const state = a.effectiveState ?? a.fileState ?? 'unknown'
      const supersededByExit =
        a.closure !== undefined && a.fileState !== 'closed'
          ? ` (closed by ${a.closure.via} exit — file still ${a.fileState ?? 'unknown'})`
          : ''
      process.stdout.write(`  - ${a.id} [${state}]${supersededByExit}\n`)
    }
    for (const issue of agreements.entries.flatMap((a) => a.issues).concat(status.exits.issues)) {
      process.stdout.write(`  ! ${issue}\n`)
    }
    process.stdout.write(
      `\nInbox:    ${String(inbox.total)} signal${inbox.total === 1 ? '' : 's'} ` +
        `(${String(inbox.verified)} verified` +
        `${inbox.flagged > 0 ? `, ${String(inbox.flagged)} flagged` : ''})\n`,
    )
    if (inbox.flagged > 0) {
      process.stdout.write('  Run `flyway check` to inspect flagged signals.\n')
    }
    const peerSigBroken = peers.entries.some((p) => !p.recognitionValid)
    return identity.initialized && identity.issues.length === 0 && !peerSigBroken ? 0 : 1
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleRecognizeCommand(args: string[]): Promise<number> {
  const { value: note, rest: r1 } = parseFlag(args, '--note')
  const { value: branch, rest: r2 } = parseFlag(r1, '--branch')
  const { present: allowPrivate, rest: r3 } = parseBoolFlag(r2, '--allow-private-host')
  const { present: force, rest: positional } = parseBoolFlag(r3, '--force')
  const [locator] = positional
  if (!locator) {
    process.stderr.write(
      'error: flyway recognize requires a peer repo path or did:web identifier\n\n',
    )
    process.stderr.write(HELP)
    return 2
  }
  // A did:web argument is resolved over HTTPS; anything else is a local path.
  const isDid = locator.startsWith('did:')
  try {
    const result = await runRecognize({
      cwd: process.cwd(),
      ...(isDid ? { peerDid: locator } : { peerRepoPath: locator }),
      force,
      ...(branch !== undefined ? { branch } : {}),
      ...(allowPrivate ? { allowPrivate: true } : {}),
      ...(note !== undefined ? { note } : {}),
    })
    process.stdout.write(
      `Recognized ${result.peerDid}` +
        (result.replacedPriorEntry ? ' (replaced prior entry)' : '') +
        '\n',
    )
    process.stdout.write(`  recognizedAt: ${result.entry.recognizedAt}\n`)
    process.stdout.write(`  fingerprint:  ${result.entry.entityStatementFingerprint}\n`)
    for (const file of result.filesWritten) {
      process.stdout.write(`  wrote ${file}\n`)
    }
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleUnrecognizeCommand(args: string[]): Promise<number> {
  const { value: reason, rest: positional } = parseFlag(args, '--reason')
  const [peerDid] = positional
  if (!peerDid) {
    process.stderr.write('error: flyway unrecognize requires a peer DID\n\n')
    process.stderr.write(HELP)
    return 2
  }
  try {
    const result = await runUnrecognize({
      cwd: process.cwd(),
      peerDid,
      ...(reason !== undefined ? { reason } : {}),
    })
    process.stdout.write(`Unrecognized ${result.peerDid}\n`)
    process.stdout.write(`  unrecognizedAt: ${result.record.unrecognizedAt}\n`)
    process.stdout.write(`  wrote ${result.recordPath}\n`)
    process.stdout.write(`  updated ${result.peersFilePath}\n`)
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleTensionCommand(args: string[]): Promise<number> {
  const { transport, rest: t0, error: transportError } = parseTransportFlag(args)
  if (transportError) {
    process.stderr.write(`error: ${transportError}\n`)
    return 2
  }
  const { value: conditions, rest: r1 } = parseFlag(t0, '--conditions')
  const { value: effect, rest: r2 } = parseFlag(r1, '--effect')
  const { value: relevance, rest: r3 } = parseFlag(r2, '--relevance')
  const { value: proposedOwner, rest: positional } = parseFlag(r3, '--proposed-owner')
  const [peerRepoPath] = positional
  if (!peerRepoPath) {
    process.stderr.write('error: flyway tension requires a peer repo path\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!conditions || !effect) {
    process.stderr.write('error: flyway tension requires --conditions and --effect\n\n')
    process.stderr.write(HELP)
    return 2
  }
  try {
    const result = await runTension({
      cwd: process.cwd(),
      peerRepoPath,
      body: {
        conditions,
        effect,
        ...(relevance !== undefined ? { relevance } : {}),
        ...(proposedOwner !== undefined ? { proposedOwner } : {}),
      },
      ...(transport !== undefined ? { transport } : {}),
    })
    process.stdout.write(
      `Flagged tension to ${result.peerDid}\n` +
        `  id:       ${result.signal.id}\n` +
        `  sentAt:   ${result.signal.sentAt}\n` +
        `  wrote ${result.outboxPath}\n` +
        formatDelivery(result.receipt),
    )
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

function isTensionDecision(value: string): value is TensionDecision {
  return (TENSION_DECISIONS as readonly string[]).includes(value)
}

function isProposalDecision(value: string): value is ProposalDecision {
  return (PROPOSAL_DECISIONS as readonly string[]).includes(value)
}

function isProposalType(value: string): value is ProposalType {
  return (PROPOSAL_TYPES as readonly string[]).includes(value)
}

function isProposalStage(value: string): value is ProposalStage {
  return (PROPOSAL_STAGES as readonly string[]).includes(value)
}

/** Collect every `--<flag>` occurrence and return its values + the rest of argv. */
function parseRepeatedFlag(args: string[], flag: string): { values: string[]; rest: string[] } {
  const values: string[] = []
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      const next = args[i + 1]
      if (next !== undefined) values.push(next)
      i++
    } else {
      const item = args[i]
      if (item !== undefined) rest.push(item)
    }
  }
  return { values, rest }
}

async function handleRespondCommand(args: string[]): Promise<number> {
  const { transport, rest: t0, error: transportError } = parseTransportFlag(args)
  if (transportError) {
    process.stderr.write(`error: ${transportError}\n`)
    return 2
  }
  const { value: subjectId, rest: r1 } = parseFlag(t0, '--subject-id')
  const { value: decisionRaw, rest: r2 } = parseFlag(r1, '--decision')
  const { value: reason, rest: r3 } = parseFlag(r2, '--reason')
  const { value: transferTo, rest: r4 } = parseFlag(r3, '--transfer-to')
  const { values: concerns, rest: positional } = parseRepeatedFlag(r4, '--concern')
  const [peerRepoPath] = positional
  if (!peerRepoPath) {
    process.stderr.write('error: flyway respond requires a peer repo path\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!subjectId || !decisionRaw) {
    process.stderr.write('error: flyway respond requires --subject-id and --decision\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!isTensionDecision(decisionRaw) && !isProposalDecision(decisionRaw)) {
    process.stderr.write(
      `error: --decision must be a tension decision (${TENSION_DECISIONS.join(', ')}) ` +
        `or a proposal decision (${PROPOSAL_DECISIONS.join(', ')}); got: ${decisionRaw}\n`,
    )
    return 2
  }
  try {
    const result = await runRespond({
      cwd: process.cwd(),
      peerRepoPath,
      subjectId,
      decision: decisionRaw,
      ...(reason !== undefined ? { reason } : {}),
      ...(transferTo !== undefined ? { transferTo } : {}),
      ...(concerns.length > 0 ? { concernsToRecord: concerns } : {}),
      ...(transport !== undefined ? { transport } : {}),
    })
    process.stdout.write(
      `Responded to ${result.subject.kind} ${result.subject.id} from ${result.peerDid}\n` +
        `  decision: ${(result.response.body as { decision: string }).decision}\n` +
        `  id:       ${result.response.id}\n` +
        `  sentAt:   ${result.response.sentAt}\n` +
        `  wrote ${result.outboxPath}\n` +
        formatDelivery(result.receipt),
    )
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleProposeCommand(args: string[]): Promise<number> {
  const { transport, rest: t0, error: transportError } = parseTransportFlag(args)
  if (transportError) {
    process.stderr.write(`error: ${transportError}\n`)
    return 2
  }
  const { value: typeRaw, rest: r1 } = parseFlag(t0, '--type')
  const { value: title, rest: r2 } = parseFlag(r1, '--title')
  const { value: body, rest: r3 } = parseFlag(r2, '--body')
  const { value: stageRaw, rest: r4 } = parseFlag(r3, '--stage')
  const { value: previousStageId, rest: r5 } = parseFlag(r4, '--previous-stage-id')
  const { value: promoteTensionId, rest: r6 } = parseFlag(r5, '--promote-tension-id')
  const { value: deadline, rest: r7 } = parseFlag(r6, '--deadline')
  const { value: agreementFile, rest: r8 } = parseFlag(r7, '--agreement-file')
  const { value: requirementsFile, rest: positional } = parseFlag(r8, '--requirements-file')
  const [peerRepoPath] = positional

  if (!peerRepoPath) {
    process.stderr.write('error: flyway propose requires a peer repo path\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!typeRaw || !title || !body) {
    process.stderr.write('error: flyway propose requires --type, --title, and --body\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!isProposalType(typeRaw)) {
    process.stderr.write(
      `error: --type must be one of ${PROPOSAL_TYPES.join(', ')} (got: ${typeRaw})\n`,
    )
    return 2
  }
  let stage: ProposalStage | undefined
  if (stageRaw !== undefined) {
    if (!isProposalStage(stageRaw)) {
      process.stderr.write(
        `error: --stage must be one of ${PROPOSAL_STAGES.join(', ')} (got: ${stageRaw})\n`,
      )
      return 2
    }
    stage = stageRaw
  }

  // Load optional structured sidecars (agreement, requirements).
  const { readFileSync, existsSync } = await import('node:fs')
  const { parseDocument } = await import('yaml')

  let agreement: unknown
  if (typeRaw === 'agreement') {
    if (!agreementFile) {
      process.stderr.write(
        'error: --type=agreement requires --agreement-file <path> pointing at a YAML/JSON FlywayAgreement.\n',
      )
      return 2
    }
    if (!existsSync(agreementFile)) {
      process.stderr.write(`error: --agreement-file '${agreementFile}' does not exist.\n`)
      return 2
    }
    const raw = readFileSync(agreementFile, 'utf-8')
    agreement = parseDocument(raw).toJS()
  }

  let requirements: ProposalRequirement[] | undefined
  if (stage === 'requirements') {
    if (!requirementsFile) {
      process.stderr.write(
        'error: --stage=requirements requires --requirements-file <path> pointing at a YAML/JSON list of {id,description,mustOrShould?,rationale?}.\n',
      )
      return 2
    }
    if (!existsSync(requirementsFile)) {
      process.stderr.write(`error: --requirements-file '${requirementsFile}' does not exist.\n`)
      return 2
    }
    const raw = readFileSync(requirementsFile, 'utf-8')
    const parsed: unknown = parseDocument(raw).toJS()
    if (!Array.isArray(parsed)) {
      process.stderr.write(`error: --requirements-file must parse to a YAML/JSON array.\n`)
      return 2
    }
    requirements = parsed as ProposalRequirement[]
  }

  try {
    const proposalBody = {
      type: typeRaw,
      title,
      body,
      ...(stage !== undefined ? { stage } : {}),
      ...(deadline !== undefined ? { deadline } : {}),
      ...(requirements !== undefined ? { requirements } : {}),
      ...(typeRaw === 'agreement' ? { agreement } : {}),
    }
    const result = await runPropose({
      cwd: process.cwd(),
      peerRepoPath,
      // discriminated body assembled from CLI flags; structural cast to the core union
      body: proposalBody as unknown as ProposalBody,
      ...(previousStageId !== undefined ? { previousStageId } : {}),
      ...(promoteTensionId !== undefined ? { promoteTensionId } : {}),
      ...(transport !== undefined ? { transport } : {}),
    })
    process.stdout.write(
      `Proposed ${typeRaw} to ${result.peerDid}\n` +
        `  id:       ${result.proposal.id}\n` +
        `  stage:    ${stage ?? 'final'}\n` +
        `  sentAt:   ${result.proposal.sentAt}\n` +
        `  wrote ${result.outboxPath}\n` +
        formatDelivery(result.receipt),
    )
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

function isExitTargetType(value: string): value is ExitTargetType {
  return (EXIT_TARGET_TYPES as readonly string[]).includes(value)
}

async function handleExitCommand(args: string[]): Promise<number> {
  const { transport, rest: t0, error: transportError } = parseTransportFlag(args)
  if (transportError) {
    process.stderr.write(`error: ${transportError}\n`)
    return 2
  }
  const { value: targetTypeRaw, rest: r1 } = parseFlag(t0, '--target-type')
  const { value: target, rest: r2 } = parseFlag(r1, '--target')
  const { value: reason, rest: positional } = parseFlag(r2, '--reason')
  const [peerRepoPath] = positional
  if (!peerRepoPath) {
    process.stderr.write('error: flyway exit requires a peer repo path\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!targetTypeRaw) {
    process.stderr.write('error: flyway exit requires --target-type\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!isExitTargetType(targetTypeRaw)) {
    process.stderr.write(
      `error: --target-type must be one of ${EXIT_TARGET_TYPES.join(', ')} (got: ${targetTypeRaw})\n`,
    )
    return 2
  }
  try {
    const result = await runExit({
      cwd: process.cwd(),
      peerRepoPath,
      targetType: targetTypeRaw,
      ...(target !== undefined ? { target } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(transport !== undefined ? { transport } : {}),
    })
    const body = result.signal.body as { target: string; targetType: string }
    process.stdout.write(
      `Exited ${body.targetType} ${body.target} (notified ${result.peerDid})\n` +
        `  id:       ${result.signal.id}\n` +
        `  sentAt:   ${result.signal.sentAt}\n` +
        `  wrote ${result.outboxPath}\n` +
        formatDelivery(result.receipt),
    )
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleMaterializeCommand(args: string[]): Promise<number> {
  const { value: responseId, rest: r1 } = parseFlag(args, '--response-id')
  const { value: proposalId, rest: positional } = parseFlag(r1, '--proposal-id')
  const [peerRepoPath] = positional
  if (!peerRepoPath) {
    process.stderr.write('error: flyway materialize requires a peer repo path\n\n')
    process.stderr.write(HELP)
    return 2
  }
  if (!responseId) {
    process.stderr.write('error: flyway materialize requires --response-id\n\n')
    process.stderr.write(HELP)
    return 2
  }
  try {
    const result = await runMaterialize({
      cwd: process.cwd(),
      peerRepoPath,
      responseId,
      ...(proposalId !== undefined ? { proposalId } : {}),
    })
    const { materialized } = result
    process.stdout.write(
      `Materialized co-signed agreement with ${result.peerDid}\n` +
        `  agreement: ${materialized.agreement.id}\n` +
        `  state:     ${materialized.agreement.state}\n` +
        `  signers:   ${String(materialized.agreement.signatures?.map((s) => s.participant).join(', '))}\n` +
        `  sha256:    ${materialized.sha256}\n` +
        (result.created
          ? `  wrote ${result.path}\n`
          : `  already on file ${result.path} (identical bytes)\n`) +
        '\nThe peer materializes the same file from their own records — compare\n' +
        'the sha256 values to confirm byte-identity.\n',
    )
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleDiscoverCommand(args: string[]): Promise<number> {
  const { present: asJson, rest: r1 } = parseBoolFlag(args, '--json')
  const { present: allowPrivate, rest: r2 } = parseBoolFlag(r1, '--allow-private-directory')
  const { value: directory, rest: positional } = parseFlag(r2, '--directory')
  const [query] = positional
  if (!directory) {
    process.stderr.write('error: flyway discover requires --directory <path-or-url>\n\n')
    process.stderr.write(HELP)
    return 2
  }
  try {
    const result = await runDiscover({
      directory,
      ...(query !== undefined ? { query } : {}),
      ...(allowPrivate ? { allowPrivateDirectory: true } : {}),
    })
    if (asJson) {
      process.stdout.write(
        JSON.stringify(
          {
            query: result.query,
            byDid: result.byDid,
            total: result.total,
            matches: result.matches,
          },
          null,
          2,
        ) + '\n',
      )
      return 0
    }
    const scope = result.query
      ? `${String(result.matches.length)} of ${String(result.total)} match${result.matches.length === 1 ? '' : 'es'} for "${result.query}"`
      : `${String(result.total)} murmuration${result.total === 1 ? '' : 's'}`
    process.stdout.write(`Directory: ${scope}\n`)
    for (const e of result.matches) {
      const tags =
        e.capabilities && e.capabilities.length > 0 ? `  [${e.capabilities.join(', ')}]` : ''
      const mode = e.mode ? ` (${e.mode})` : ''
      process.stdout.write(`  - ${e.sourceName}${mode}  ${e.did}${tags}\n`)
      if (e.repoUrl) process.stdout.write(`      ${e.repoUrl}\n`)
    }
    if (result.matches.length === 0) {
      process.stdout.write('  (no matches — try a broader term, or omit the query to list all)\n')
    }
    return 0
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleCheckCommand(args: string[]): Promise<number> {
  const { present: asJson } = parseBoolFlag(args, '--json')
  try {
    const inbox = await flywayCheck(process.cwd())
    if (asJson) {
      process.stdout.write(JSON.stringify(inbox, null, 2) + '\n')
      return inbox.totalCount === inbox.validCount ? 0 : 1
    }
    if (inbox.totalCount === 0) {
      process.stdout.write('No signals in inbox.\n')
      return 0
    }
    process.stdout.write(
      `Inbox: ${String(inbox.totalCount)} signal${inbox.totalCount === 1 ? '' : 's'} (${String(inbox.validCount)} verified)\n`,
    )
    for (const s of inbox.signals) {
      const status = s.signatureValid
        ? 'sig valid'
        : s.signatureValid === false
          ? 'sig INVALID'
          : 'unverified (unrecognized sender)'
      process.stdout.write(
        `  - ${s.envelope.kind.padEnd(8)} ${s.envelope.id}  from ${s.envelope.from}  [${status}]\n`,
      )
      for (const issue of s.issues) {
        process.stdout.write(`      ! ${issue}\n`)
      }
    }
    for (const issue of inbox.issues) {
      process.stdout.write(`  ! ${issue}\n`)
    }
    return inbox.totalCount === inbox.validCount ? 0 : 1
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'init':
      return handleInitCommand(rest)
    case 'status':
      return handleStatusCommand(rest)
    case 'recognize':
      return handleRecognizeCommand(rest)
    case 'unrecognize':
      return handleUnrecognizeCommand(rest)
    case 'check':
      return handleCheckCommand(rest)
    case 'tension':
      return handleTensionCommand(rest)
    case 'respond':
      return handleRespondCommand(rest)
    case 'propose':
      return handleProposeCommand(rest)
    case 'materialize':
      return handleMaterializeCommand(rest)
    case 'exit':
      return handleExitCommand(rest)
    case 'discover':
      return handleDiscoverCommand(rest)
    case 'skill':
      return handleSkillCommand(rest)
    case '--version':
    case '-v':
      process.stdout.write(`${FLYWAY_PROTOCOL_VERSION}\n`)
      return 0
    case '--help':
    case '-h':
      process.stdout.write(HELP)
      return 0
    case undefined:
      process.stdout.write(HELP)
      return 1
    default:
      process.stderr.write(`error: unknown command: ${command}\n\n`)
      process.stderr.write(HELP)
      return 2
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`)
    process.exit(1)
  },
)

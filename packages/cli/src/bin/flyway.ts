#!/usr/bin/env node
import {
  FLYWAY_PROTOCOL_VERSION,
  type FlywayMode,
  flywayStatus,
} from '@murmurations-ai/flyway-core'
import { runInit } from '../init.js'
import { runRecognize } from '../recognize.js'
import { runUnrecognize } from '../unrecognize.js'
import {
  inferTarget,
  installSkill,
  listSkills,
  SKILL_REGISTRY,
  uninstallSkill,
} from '../skill.js'

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

  recognize <peer-repo-path> [--note "..."] [--force]
                                      Verify a peer's identity and add a
                                      signed recognition entry to
                                      flyway/peers.yaml.

  unrecognize <peer-did> [--reason "..."]
                                      Withdraw recognition of a peer.
                                      Writes a signed unrecognition record
                                      to flyway/unrecognized/ and removes
                                      the entry from flyway/peers.yaml.

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

const VALID_MODES: readonly FlywayMode[] = [
  'persistent',
  'interactive',
  'async',
  'ephemeral',
]

function parseFlag(
  args: string[],
  flag: string,
): { value: string | undefined; rest: string[] } {
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
        process.stderr.write(
          `available skills: ${Object.keys(SKILL_REGISTRY).join(', ')}\n`,
        )
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
      process.stderr.write(
        `error: unknown skill subcommand: ${subcommand ?? '(none)'}\n\n`,
      )
      process.stderr.write(HELP)
      return 2
  }
}

function parseBoolFlag(args: string[], flag: string): { present: boolean; rest: string[] } {
  const idx = args.indexOf(flag)
  if (idx === -1) return { present: false, rest: args }
  return { present: true, rest: [...args.slice(0, idx), ...args.slice(idx + 1)] }
}

async function handleInitCommand(args: string[]): Promise<number> {
  const { value: repoUrl, rest: r1 } = parseFlag(args, '--repo-url')
  const { value: sourceName, rest: r2 } = parseFlag(r1, '--source-name')
  const { value: modeRaw, rest: r3 } = parseFlag(r2, '--mode')
  const { present: force } = parseBoolFlag(r3, '--force')

  if (!repoUrl || !sourceName) {
    process.stderr.write(
      'error: flyway init requires --repo-url and --source-name\n\n',
    )
    process.stderr.write(HELP)
    return 2
  }

  const mode: FlywayMode = (modeRaw as FlywayMode | undefined) ?? 'interactive'
  if (!VALID_MODES.includes(mode)) {
    process.stderr.write(
      `error: --mode must be one of ${VALID_MODES.join(', ')} (got: ${mode})\n`,
    )
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
    const { identity, peers, agreements } = status
    const head = identity.initialized
      ? `Identity: ${identity.did}  (signature ${identity.signatureValid ? 'valid' : 'INVALID'})`
      : 'Identity: not initialized'
    process.stdout.write(head + '\n')
    if (identity.initialized) {
      process.stdout.write(`  Source:   ${identity.sourceName}\n`)
      process.stdout.write(`  Mode:     ${identity.mode}\n`)
    }
    for (const issue of identity.issues) {
      process.stdout.write(`  ! ${issue}\n`)
    }
    process.stdout.write(
      `\nPeers:    ${
        peers.present
          ? `${peers.count} recognized`
          : 'no peers file yet'
      }\n`,
    )
    for (const peer of peers.entries) {
      const sig = peer.recognitionValid ? 'sig valid' : 'sig INVALID'
      process.stdout.write(`  - ${peer.sourceName} (${peer.did}) — ${sig}\n`)
    }
    process.stdout.write(
      `Agreements: ${agreements.count} on file` +
        (agreements.ids.length > 0 ? ` (${agreements.ids.join(', ')})` : '') +
        '\n',
    )
    const peerSigBroken = peers.entries.some((p) => !p.recognitionValid)
    return identity.initialized && identity.issues.length === 0 && !peerSigBroken ? 0 : 1
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

async function handleRecognizeCommand(args: string[]): Promise<number> {
  const { value: note, rest: r1 } = parseFlag(args, '--note')
  const { present: force, rest: positional } = parseBoolFlag(r1, '--force')
  const [peerRepoPath] = positional
  if (!peerRepoPath) {
    process.stderr.write(
      'error: flyway recognize requires a peer repo path\n\n',
    )
    process.stderr.write(HELP)
    return 2
  }
  try {
    const result = await runRecognize({
      cwd: process.cwd(),
      peerRepoPath,
      force,
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
  (e) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`)
    process.exit(1)
  },
)

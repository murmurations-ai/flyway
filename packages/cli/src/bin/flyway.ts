#!/usr/bin/env node
import { FLYWAY_PROTOCOL_VERSION } from '@murmurations-ai/flyway-core'
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
  skill list                          List available and installed skills
  skill install <name> [--target P]   Install a skill to target directory
  skill uninstall <name> [--target P] Remove a skill from target directory

Options:
  --version, -v   Show flyway protocol version
  --help, -h      Show this help

Examples:
  flyway skill list
  flyway skill install flyway
  flyway skill install flyway --target ~/.config/agent/skills

If --target is omitted, flyway infers the target from the current directory:
  .claude/skills/ if a .claude/ directory exists
  ./skills/ otherwise

More: https://github.com/murmurations-ai/flyway
`

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

function main(argv: string[]): number {
  const [command, ...rest] = argv
  switch (command) {
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

process.exit(main(process.argv.slice(2)))

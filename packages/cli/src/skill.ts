/**
 * Skill installation surface for flyway-cli.
 *
 * Implements ADR-0006 (skill distribution and installation): skill content
 * is imported from skill packages and written as Agent Skills IO–compliant
 * folders to a target directory.
 *
 * For v0.1 the registry only knows about the canonical flyway skill from
 * @murmurations-ai/flyway-agent. Future skills register here.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLYWAY_SKILL_MD } from '@murmurations-ai/flyway-agent'
import { FLYWAY_PROTOCOL_VERSION } from '@murmurations-ai/flyway-core'

export interface InstallableSkill {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly files: Readonly<Record<string, string>>
}

export const SKILL_REGISTRY: Readonly<Record<string, InstallableSkill>> = {
  flyway: {
    name: 'flyway',
    description: 'flyway protocol for cross-murmuration collaboration (grounded in Sociocracy 3.0)',
    version: FLYWAY_PROTOCOL_VERSION,
    files: {
      'SKILL.md': FLYWAY_SKILL_MD,
    },
  },
}

function knownSkillNames(): string[] {
  return Object.keys(SKILL_REGISTRY)
}

function requireSkill(name: string): InstallableSkill {
  const skill = SKILL_REGISTRY[name]
  if (!skill) {
    throw new Error(`unknown skill: ${name}. Known skills: ${knownSkillNames().join(', ')}`)
  }
  return skill
}

export interface SkillStatus {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly installedPath: string | null
  readonly hasLocalChanges: boolean
}

export function listSkills(targetDir: string): SkillStatus[] {
  return Object.values(SKILL_REGISTRY).map((skill) => {
    const skillPath = join(targetDir, skill.name)
    const skillMdPath = join(skillPath, 'SKILL.md')
    if (!existsSync(skillMdPath)) {
      return {
        name: skill.name,
        description: skill.description,
        version: skill.version,
        installedPath: null,
        hasLocalChanges: false,
      }
    }
    const installedContent = readFileSync(skillMdPath, 'utf-8')
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      installedPath: skillPath,
      hasLocalChanges: installedContent !== skill.files['SKILL.md'],
    }
  })
}

export interface InstallResult {
  readonly skillPath: string
  readonly warnings: readonly string[]
  readonly filesWritten: readonly string[]
}

export function installSkill(name: string, targetDir: string): InstallResult {
  const skill = requireSkill(name)
  const skillPath = join(targetDir, skill.name)
  mkdirSync(skillPath, { recursive: true })

  const warnings: string[] = []
  const filesWritten: string[] = []
  for (const [filename, content] of Object.entries(skill.files)) {
    const filePath = join(skillPath, filename)
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8')
      if (existing !== content) {
        warnings.push(`${filename} had local modifications; overwritten without backup`)
      }
    }
    writeFileSync(filePath, content)
    filesWritten.push(filename)
  }

  return { skillPath, warnings, filesWritten }
}

export interface UninstallResult {
  readonly skillPath: string
  readonly existed: boolean
}

export function uninstallSkill(name: string, targetDir: string): UninstallResult {
  const skill = requireSkill(name)
  const skillPath = join(targetDir, skill.name)
  const existed = existsSync(skillPath)
  if (existed) {
    rmSync(skillPath, { recursive: true, force: true })
  }
  return { skillPath, existed }
}

export interface InferredTarget {
  readonly target: string
  readonly reason: string
}

/**
 * Infer the target skills directory from cwd. Returns a path either way —
 * never throws. Per ADR-0006 §Target resolution.
 */
export function inferTarget(cwd: string = process.cwd()): InferredTarget {
  if (existsSync(join(cwd, '.claude'))) {
    return {
      target: join(cwd, '.claude', 'skills'),
      reason: '.claude/ detected (Claude Code project)',
    }
  }
  return {
    target: join(cwd, 'skills'),
    reason: 'no environment markers found; using ./skills/',
  }
}

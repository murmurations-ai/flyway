import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FLYWAY_SKILL_MD } from '@murmurations-ai/flyway-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SKILL_REGISTRY,
  inferTarget,
  installSkill,
  listSkills,
  uninstallSkill,
} from './skill.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-cli-test-'))
}

describe('SKILL_REGISTRY', () => {
  it('has the flyway skill registered', () => {
    expect(SKILL_REGISTRY['flyway']).toBeDefined()
    expect(SKILL_REGISTRY['flyway']?.name).toBe('flyway')
  })

  it('flyway skill SKILL.md content matches FLYWAY_SKILL_MD from flyway-agent', () => {
    expect(SKILL_REGISTRY['flyway']?.files['SKILL.md']).toBe(FLYWAY_SKILL_MD)
  })
})

describe('listSkills', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports flyway as not installed when target is empty', () => {
    const statuses = listSkills(tmp)
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.name).toBe('flyway')
    expect(statuses[0]?.installedPath).toBeNull()
    expect(statuses[0]?.hasLocalChanges).toBe(false)
  })

  it('reports installed when the SKILL.md exists and matches', () => {
    mkdirSync(join(tmp, 'flyway'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'SKILL.md'), FLYWAY_SKILL_MD)
    const statuses = listSkills(tmp)
    expect(statuses[0]?.installedPath).toBe(join(tmp, 'flyway'))
    expect(statuses[0]?.hasLocalChanges).toBe(false)
  })

  it('reports modified when installed content differs from registry', () => {
    mkdirSync(join(tmp, 'flyway'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'SKILL.md'), 'tampered local content')
    const statuses = listSkills(tmp)
    expect(statuses[0]?.hasLocalChanges).toBe(true)
  })
})

describe('installSkill', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes SKILL.md to <target>/<skill-name>/SKILL.md', () => {
    const result = installSkill('flyway', tmp)
    expect(result.skillPath).toBe(join(tmp, 'flyway'))
    const written = readFileSync(join(tmp, 'flyway', 'SKILL.md'), 'utf-8')
    expect(written).toBe(FLYWAY_SKILL_MD)
    expect(result.warnings).toEqual([])
    expect(result.filesWritten).toContain('SKILL.md')
  })

  it('creates nested target directories as needed', () => {
    const nested = join(tmp, 'a', 'b', 'c')
    installSkill('flyway', nested)
    expect(existsSync(join(nested, 'flyway', 'SKILL.md'))).toBe(true)
  })

  it('warns when overwriting locally-modified content', () => {
    mkdirSync(join(tmp, 'flyway'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'SKILL.md'), 'tampered')
    const result = installSkill('flyway', tmp)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('SKILL.md')
    const after = readFileSync(join(tmp, 'flyway', 'SKILL.md'), 'utf-8')
    expect(after).toBe(FLYWAY_SKILL_MD)
  })

  it('does not warn when overwriting identical content', () => {
    mkdirSync(join(tmp, 'flyway'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'SKILL.md'), FLYWAY_SKILL_MD)
    const result = installSkill('flyway', tmp)
    expect(result.warnings).toEqual([])
  })

  it('throws on unknown skill names', () => {
    expect(() => installSkill('nonexistent', tmp)).toThrow(/unknown skill/i)
  })
})

describe('uninstallSkill', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('removes the installed skill folder', () => {
    installSkill('flyway', tmp)
    const result = uninstallSkill('flyway', tmp)
    expect(result.existed).toBe(true)
    expect(existsSync(join(tmp, 'flyway'))).toBe(false)
  })

  it('is idempotent when the skill was not installed', () => {
    const result = uninstallSkill('flyway', tmp)
    expect(result.existed).toBe(false)
  })

  it('throws on unknown skill names', () => {
    expect(() => uninstallSkill('nonexistent', tmp)).toThrow(/unknown skill/i)
  })
})

describe('inferTarget', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns .claude/skills/ when .claude/ exists', () => {
    mkdirSync(join(tmp, '.claude'))
    const result = inferTarget(tmp)
    expect(result.target).toBe(join(tmp, '.claude', 'skills'))
    expect(result.reason).toContain('.claude')
  })

  it('defaults to ./skills/ when no markers are present', () => {
    const result = inferTarget(tmp)
    expect(result.target).toBe(join(tmp, 'skills'))
    expect(result.reason).toContain('no environment markers')
  })
})

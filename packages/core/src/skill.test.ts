import { describe, expect, it } from 'vitest'
import { createFlywaySkill, FLYWAY_TOOLS } from './index.js'
import type { FlywayToolName } from './index.js'

const EXPECTED_TOOLS: FlywayToolName[] = [
  'flyway_init',
  'flyway_status',
  'flyway_discover',
  'flyway_recognize',
  'flyway_propose',
  'flyway_respond',
  'flyway_check',
  'flyway_exit',
]

describe('createFlywaySkill', () => {
  it('returns a skill with all eight tools', () => {
    const skill = createFlywaySkill()
    expect(skill.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS)
  })

  it('every tool has a non-empty description', () => {
    const skill = createFlywaySkill()
    for (const tool of skill.tools) {
      expect(tool.description.length, `${tool.name} description is empty`).toBeGreaterThan(0)
    }
  })

  it('every required tool input schema has a type', () => {
    const skill = createFlywaySkill()
    for (const tool of skill.tools) {
      expect(tool.inputSchema.type, `${tool.name} inputSchema missing type`).toBeDefined()
    }
  })

  it('skill version matches FLYWAY_TOOLS export', () => {
    const skill = createFlywaySkill()
    expect(skill.tools).toBe(FLYWAY_TOOLS)
  })

  it('instructions are non-empty and mention key invariants', () => {
    const skill = createFlywaySkill()
    expect(skill.instructions).toContain('Source sovereignty')
    expect(skill.instructions).toContain('exit')
    expect(skill.instructions).toContain('consent')
  })

  it('instructions cite the load-bearing S3 patterns by section', () => {
    const skill = createFlywaySkill()
    expect(skill.instructions).toContain('§IV.1.5') // Consent Decision-Making
    expect(skill.instructions).toContain('§IV.1.6') // Test if Arguments Qualify as Objections
    expect(skill.instructions).toContain('§IV.1.7') // Resolve Objections
  })

  it('instructions distinguish objection from concern (S3 vocabulary)', () => {
    const skill = createFlywaySkill()
    expect(skill.instructions).toContain('Objection')
    expect(skill.instructions).toContain('Concern')
    expect(skill.instructions).toContain('good enough for now')
  })
})

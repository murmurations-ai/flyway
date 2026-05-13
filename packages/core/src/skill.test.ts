import { describe, expect, it } from 'vitest'
import { createFlywaySkill, FLYWAY_TOOLS } from './index.js'
import type { FlywayToolName } from './index.js'

const EXPECTED_TOOLS: FlywayToolName[] = [
  'flyway_init',
  'flyway_status',
  'flyway_discover',
  'flyway_recognize',
  'flyway_tension',
  'flyway_propose',
  'flyway_respond',
  'flyway_check',
  'flyway_exit',
]

describe('createFlywaySkill', () => {
  it('returns a skill with all nine tools in the expected order', () => {
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

  it('instructions cite Navigate via Tension and Describe Organizational Drivers', () => {
    const skill = createFlywaySkill()
    expect(skill.instructions).toContain('§IV.1.2')
    expect(skill.instructions).toContain('§IV.1.3')
    expect(skill.instructions).toContain('tension')
  })

  it('flyway_tension has the three S3 driver-description fields', () => {
    const skill = createFlywaySkill()
    const tension = skill.tools.find((t) => t.name === 'flyway_tension')
    expect(tension).toBeDefined()
    const props = tension?.inputSchema.properties
    expect(props).toBeDefined()
    expect(props).toHaveProperty('conditions')
    expect(props).toHaveProperty('effect')
    expect(props).toHaveProperty('relevance')
  })

  it('flyway_respond decision enum covers both proposals and tensions', () => {
    const skill = createFlywaySkill()
    const respond = skill.tools.find((t) => t.name === 'flyway_respond')
    expect(respond).toBeDefined()
    const decisionSchema = respond?.inputSchema.properties?.['decision']
    expect(decisionSchema?.enum).toEqual(
      expect.arrayContaining(['accept', 'object', 'exit', 'acknowledge', 'dispute', 'dissolve', 'transfer']),
    )
  })

  it('flyway_propose has the four S3 proposal-forming stages plus final', () => {
    const skill = createFlywaySkill()
    const propose = skill.tools.find((t) => t.name === 'flyway_propose')
    expect(propose).toBeDefined()
    const stageSchema = propose?.inputSchema.properties?.['stage']
    expect(stageSchema?.enum).toEqual(['driver', 'requirements', 'draft', 'refinement', 'final'])
  })

  it('flyway_propose stage field is optional (preserves single-shot proposals)', () => {
    const skill = createFlywaySkill()
    const propose = skill.tools.find((t) => t.name === 'flyway_propose')
    expect(propose?.inputSchema.required).not.toContain('stage')
  })

  it('flyway_propose has previousStageId for linking refinements back to drafts', () => {
    const skill = createFlywaySkill()
    const propose = skill.tools.find((t) => t.name === 'flyway_propose')
    expect(propose?.inputSchema.properties).toHaveProperty('previousStageId')
  })

  it('instructions cite Proposal Forming patterns (§IV.1.9–1.10)', () => {
    const skill = createFlywaySkill()
    expect(skill.instructions).toContain('§IV.1.9–1.10')
    expect(skill.instructions).toMatch(/Co-Create Proposals|Proposal Forming/)
  })
})

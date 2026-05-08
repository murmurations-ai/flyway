import { createFlywaySkill } from '@murmurations-ai/flyway-core'
import { describe, expect, it } from 'vitest'
import { FLYWAY_SKILL_MD, toSkillMarkdown } from './adapters.js'

const skill = createFlywaySkill()

describe('toSkillMarkdown (Agent Skills IO format)', () => {
  it('name field is "flyway" (matches required directory name)', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain('name: flyway')
  })

  it('includes a description mentioning murmuration', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toMatch(/description:/)
    expect(md).toContain('murmuration')
  })

  it('includes license field', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain('license: MIT')
  })

  it('includes metadata with version', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain(`version: "${skill.version}"`)
  })

  it('includes the protocol instructions in the body', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain('Source sovereignty')
    expect(md).toContain('exit')
    expect(md).toContain('consent')
  })

  it('lists all eight tools in the body', () => {
    const md = toSkillMarkdown(skill)
    for (const tool of skill.tools) {
      expect(md).toContain(tool.name)
    }
  })

  it('frontmatter comes before body (--- delimiters)', () => {
    const md = toSkillMarkdown(skill)
    const firstDelimiter = md.indexOf('---')
    const secondDelimiter = md.indexOf('---', firstDelimiter + 3)
    expect(firstDelimiter).toBe(0)
    expect(secondDelimiter).toBeGreaterThan(3)
  })
})

describe('FLYWAY_SKILL_MD', () => {
  it('is a string', () => {
    expect(typeof FLYWAY_SKILL_MD).toBe('string')
  })

  it('matches toSkillMarkdown output for the canonical skill', () => {
    expect(FLYWAY_SKILL_MD).toBe(toSkillMarkdown(skill))
  })
})

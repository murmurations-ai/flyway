import { createFlywaySkill } from '@murmurations-ai/flyway-core'
import { describe, expect, it } from 'vitest'
import { toAnthropicTools, toGeminiTools, toOpenAITools, toSkillMarkdown } from './adapters.js'

const skill = createFlywaySkill()

describe('toAnthropicTools', () => {
  it('produces input_schema (not inputSchema)', () => {
    const tools = toAnthropicTools(skill.tools)
    for (const tool of tools) {
      expect(tool).toHaveProperty('input_schema')
      expect(tool).not.toHaveProperty('inputSchema')
    }
  })

  it('preserves name and description', () => {
    const tools = toAnthropicTools(skill.tools)
    expect(tools[0]?.name).toBe('flyway_init')
    expect(tools[0]?.description.length).toBeGreaterThan(0)
  })

  it('returns one tool per canonical tool', () => {
    expect(toAnthropicTools(skill.tools)).toHaveLength(skill.tools.length)
  })
})

describe('toOpenAITools', () => {
  it('wraps each tool in type: function', () => {
    const tools = toOpenAITools(skill.tools)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      expect(tool.function).toBeDefined()
    }
  })

  it('puts the schema under .function.parameters', () => {
    const tools = toOpenAITools(skill.tools)
    for (const tool of tools) {
      expect(tool.function).toHaveProperty('parameters')
      expect(tool.function).not.toHaveProperty('inputSchema')
    }
  })

  it('sets strict: true', () => {
    const tools = toOpenAITools(skill.tools)
    for (const tool of tools) {
      expect(tool.function.strict).toBe(true)
    }
  })
})

describe('toGeminiTools', () => {
  it('puts the schema under parameters (not inputSchema)', () => {
    const tools = toGeminiTools(skill.tools)
    for (const tool of tools) {
      expect(tool).toHaveProperty('parameters')
      expect(tool).not.toHaveProperty('inputSchema')
    }
  })

  it('preserves name and description', () => {
    const tools = toGeminiTools(skill.tools)
    expect(tools[0]?.name).toBe('flyway_init')
  })
})

describe('toSkillMarkdown (Agent Skills IO format)', () => {
  it('name field is "flyway" (matches required directory name)', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain('name: flyway')
  })

  it('includes a non-empty description field', () => {
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

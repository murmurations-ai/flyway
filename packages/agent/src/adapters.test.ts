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

describe('toSkillMarkdown', () => {
  it('includes YAML frontmatter with name and version', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain('name: flyway')
    expect(md).toContain(`version: ${skill.version}`)
  })

  it('includes the protocol instructions', () => {
    const md = toSkillMarkdown(skill)
    expect(md).toContain('Source sovereignty')
    expect(md).toContain('murmuration')
  })

  it('lists all eight tools', () => {
    const md = toSkillMarkdown(skill)
    for (const tool of skill.tools) {
      expect(md).toContain(tool.name)
    }
  })
})

import { FLYWAY_TOOLS } from '@murmurations-ai/flyway-core'
import { describe, expect, it } from 'vitest'
import { callFlywayTool, listFlywayTools } from './handlers.js'

describe('listFlywayTools', () => {
  it('returns all eight flyway tools', () => {
    const result = listFlywayTools()
    expect(result.tools).toHaveLength(FLYWAY_TOOLS.length)
  })

  it('preserves tool names from flyway-core', () => {
    const result = listFlywayTools()
    const names = result.tools.map((t) => t.name)
    expect(names).toEqual(FLYWAY_TOOLS.map((t) => t.name))
  })

  it('every tool has an inputSchema (MCP-compatible field name)', () => {
    const result = listFlywayTools()
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})

describe('callFlywayTool', () => {
  it('returns isError: true for any tool (not yet implemented)', () => {
    const result = callFlywayTool({
      method: 'tools/call',
      params: { name: 'flyway_init', arguments: {} },
    })
    expect(result.isError).toBe(true)
  })

  it('includes the requested tool name in the error message', () => {
    const result = callFlywayTool({
      method: 'tools/call',
      params: { name: 'flyway_discover', arguments: {} },
    })
    const text = result.content[0]
    expect(text?.type).toBe('text')
    if (text?.type === 'text') {
      expect(text.text).toContain('flyway_discover')
      expect(text.text).toContain('design phase')
    }
  })
})

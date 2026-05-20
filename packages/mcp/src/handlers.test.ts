import { FLYWAY_TOOLS } from '@murmurations-ai/flyway-core'
import { describe, expect, it } from 'vitest'
import { callFlywayTool, listFlywayTools } from './handlers.js'

describe('listFlywayTools', () => {
  it('returns every flyway tool defined in flyway-core', () => {
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

describe('callFlywayTool — flyway_init (implemented)', () => {
  it('returns signed artifacts (no isError) for valid input', async () => {
    const result = await callFlywayTool({
      method: 'tools/call',
      params: {
        name: 'flyway_init',
        arguments: {
          repoUrl: 'https://github.com/xeeban/flyway',
          sourceName: 'Nori',
          mode: 'interactive',
        },
      },
    })
    expect(result.isError).toBeUndefined()
    const first = result.content[0]
    if (first?.type !== 'text') throw new Error('expected text content')
    const payload = JSON.parse(first.text)
    expect(payload.did).toBe('did:web:github.com:xeeban:flyway')
    expect(payload.didDocument.id).toBe(payload.did)
    expect(payload.entityStatement.sourceName).toBe('Nori')
    expect(payload.keypair.publicKeyJwk.crv).toBe('Ed25519')
    expect(payload.entityStatement.signature.algorithm).toBe('EdDSA')
    expect(payload.entityStatement.signature.domain).toBe('flyway-v1:entity-statement')
  })

  it('returns isError for missing arguments', async () => {
    const result = await callFlywayTool({
      method: 'tools/call',
      params: { name: 'flyway_init', arguments: {} },
    })
    expect(result.isError).toBe(true)
  })

  it('returns isError for invalid repoUrl', async () => {
    const result = await callFlywayTool({
      method: 'tools/call',
      params: {
        name: 'flyway_init',
        arguments: {
          repoUrl: 'not a url',
          sourceName: 'Nori',
          mode: 'interactive',
        },
      },
    })
    expect(result.isError).toBe(true)
  })
})

describe('callFlywayTool — flyway_status (implemented)', () => {
  it('returns a status payload (no isError) for the current working directory', async () => {
    const result = await callFlywayTool({
      method: 'tools/call',
      params: { name: 'flyway_status', arguments: {} },
    })
    expect(result.isError).toBeUndefined()
    const first = result.content[0]
    if (first?.type !== 'text') throw new Error('expected text content')
    const payload = JSON.parse(first.text)
    expect(payload).toHaveProperty('identity')
    expect(payload).toHaveProperty('peers')
    expect(payload).toHaveProperty('agreements')
    expect(payload.identity).toHaveProperty('initialized')
  })

  it('honours an explicit cwd argument', async () => {
    const result = await callFlywayTool({
      method: 'tools/call',
      params: { name: 'flyway_status', arguments: { cwd: '/' } },
    })
    expect(result.isError).toBeUndefined()
    const first = result.content[0]
    if (first?.type !== 'text') throw new Error('expected text content')
    const payload = JSON.parse(first.text)
    expect(payload.cwd).toBe('/')
    expect(payload.identity.initialized).toBe(false)
  })
})

describe('callFlywayTool — other tools (not yet implemented)', () => {
  it('returns isError for unimplemented tools', async () => {
    const result = await callFlywayTool({
      method: 'tools/call',
      params: { name: 'flyway_discover', arguments: {} },
    })
    expect(result.isError).toBe(true)
    const text = result.content[0]
    if (text?.type === 'text') {
      expect(text.text).toContain('flyway_discover')
      expect(text.text).toContain('not yet implemented')
    }
  })
})

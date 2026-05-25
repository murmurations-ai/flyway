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

describe('callFlywayTool — flyway_tension (implemented)', () => {
  async function makeIdentity() {
    const init = await callFlywayTool({
      method: 'tools/call',
      params: {
        name: 'flyway_init',
        arguments: {
          repoUrl: 'https://github.com/xeeban/a',
          sourceName: 'Nori',
          mode: 'interactive',
        },
      },
    })
    const first = init.content[0]
    if (first?.type !== 'text') throw new Error('expected text content')
    return JSON.parse(first.text) as {
      did: string
      didDocument: unknown
      keypair: { privateKeyPem: string }
    }
  }

  it('returns a signed tension envelope for valid input', async () => {
    const me = await makeIdentity()
    const result = await callFlywayTool({
      method: 'tools/call',
      params: {
        name: 'flyway_tension',
        arguments: {
          ownDidDocument: me.didDocument,
          ownPrivateKeyPem: me.keypair.privateKeyPem,
          peerDid: 'did:web:github.com:emergent:praxis',
          conditions: 'Sprint reviews run long.',
          effect: 'Retros are being skipped.',
          relevance: 'Both teams lose feedback loop quality.',
        },
      },
    })
    expect(result.isError).toBeUndefined()
    const first = result.content[0]
    if (first?.type !== 'text') throw new Error('expected text content')
    const payload = JSON.parse(first.text)
    expect(payload.envelope.kind).toBe('tension')
    expect(payload.envelope.from).toBe(me.did)
    expect(payload.envelope.to).toBe('did:web:github.com:emergent:praxis')
    expect(payload.envelope.signature.domain).toBe('flyway-v1:tension')
    expect(payload.envelope.body.conditions).toBe('Sprint reviews run long.')
    expect(payload.envelope.body.relevance).toBe('Both teams lose feedback loop quality.')
  })

  it('returns isError for missing required fields', async () => {
    const me = await makeIdentity()
    const result = await callFlywayTool({
      method: 'tools/call',
      params: {
        name: 'flyway_tension',
        arguments: {
          ownDidDocument: me.didDocument,
          ownPrivateKeyPem: me.keypair.privateKeyPem,
          peerDid: 'did:web:github.com:emergent:praxis',
          // conditions and effect missing
        },
      },
    })
    expect(result.isError).toBe(true)
  })

  it('returns isError when body validation fails (empty conditions)', async () => {
    const me = await makeIdentity()
    const result = await callFlywayTool({
      method: 'tools/call',
      params: {
        name: 'flyway_tension',
        arguments: {
          ownDidDocument: me.didDocument,
          ownPrivateKeyPem: me.keypair.privateKeyPem,
          peerDid: 'did:web:github.com:emergent:praxis',
          conditions: '',
          effect: 'Y',
        },
      },
    })
    expect(result.isError).toBe(true)
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

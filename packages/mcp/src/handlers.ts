import {
  FLYWAY_TOOLS,
  type FlywayMode,
  flywayInit,
} from '@murmurations-ai/flyway-core'
import type {
  CallToolRequest,
  CallToolResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'

const NOT_IMPLEMENTED_NOTICE =
  'flyway is in design phase; this tool is not yet implemented. ' +
  'See https://github.com/murmurations-ai/flyway for status.'

export function listFlywayTools(): ListToolsResult {
  return {
    tools: FLYWAY_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> & { type: 'object' },
    })),
  }
}

export function callFlywayTool(request: CallToolRequest): CallToolResult {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'flyway_init':
      return handleInit(args)
    default:
      return notImplemented(name)
  }
}

function notImplemented(name: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${name}: ${NOT_IMPLEMENTED_NOTICE}` }],
    isError: true,
  }
}

function handleInit(args: Record<string, unknown> | undefined): CallToolResult {
  if (!args || typeof args !== 'object') {
    return errorResult('flyway_init requires arguments: repoUrl, sourceName, mode')
  }
  const { repoUrl, sourceName, mode } = args as Record<string, unknown>
  if (typeof repoUrl !== 'string' || typeof sourceName !== 'string' || typeof mode !== 'string') {
    return errorResult('flyway_init requires string repoUrl, sourceName, and mode')
  }
  try {
    const artifacts = flywayInit({
      repoUrl,
      sourceName,
      mode: mode as FlywayMode,
    })
    // MCP-side flyway_init returns the artifacts; the calling agent is
    // responsible for writing them to its repo (or for invoking the CLI
    // which does write them). This keeps the MCP server stateless.
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              did: artifacts.did,
              didDocument: artifacts.didDocument,
              entityStatement: artifacts.entityStatement,
              keypair: {
                publicKeyJwk: artifacts.keypair.publicKeyJwk,
                privateKeyPem: artifacts.keypair.privateKeyPem,
              },
              note:
                'Persist these artifacts to .well-known/did.json, ' +
                'flyway/entity-statement.json, and flyway/keys/source.key in the ' +
                "Source's repo. Add flyway/keys/ to .gitignore. The private key " +
                'must not be committed.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_init failed: ${(e as Error).message}`)
  }
}

function errorResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  }
}

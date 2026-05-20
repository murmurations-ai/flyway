import {
  FLYWAY_TOOLS,
  type FlywayMode,
  flywayInit,
  flywayStatus,
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

export async function callFlywayTool(request: CallToolRequest): Promise<CallToolResult> {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'flyway_init':
      return handleInit(args)
    case 'flyway_status':
      return handleStatus(args)
    default:
      return notImplemented(name)
  }
}

async function handleStatus(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  // flyway_status has no required arguments (empty inputSchema). An optional
  // cwd override is honoured if a caller wants to inspect a different repo
  // checkout; otherwise we use the MCP server's working directory.
  const cwdArg = args && typeof args === 'object' ? (args as Record<string, unknown>).cwd : undefined
  const cwd = typeof cwdArg === 'string' ? cwdArg : process.cwd()
  try {
    const status = await flywayStatus(cwd)
    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
    }
  } catch (e) {
    return errorResult(`flyway_status failed: ${(e as Error).message}`)
  }
}

function notImplemented(name: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${name}: ${NOT_IMPLEMENTED_NOTICE}` }],
    isError: true,
  }
}

async function handleInit(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  if (!args || typeof args !== 'object') {
    return errorResult('flyway_init requires arguments: repoUrl, sourceName, mode')
  }
  const { repoUrl, sourceName, mode } = args as Record<string, unknown>
  if (typeof repoUrl !== 'string' || typeof sourceName !== 'string' || typeof mode !== 'string') {
    return errorResult('flyway_init requires string repoUrl, sourceName, and mode')
  }
  try {
    const artifacts = await flywayInit({
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

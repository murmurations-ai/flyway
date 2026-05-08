import { FLYWAY_TOOLS } from '@murmurations-ai/flyway-core'
import type { CallToolRequest, CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

const NOT_IMPLEMENTED_NOTICE =
  'flyway is in design phase; tool execution will land in a future release. ' +
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
  return {
    content: [
      {
        type: 'text',
        text: `${request.params.name}: ${NOT_IMPLEMENTED_NOTICE}`,
      },
    ],
    isError: true,
  }
}

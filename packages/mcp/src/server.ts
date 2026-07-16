import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { FLYWAY_PROTOCOL_VERSION } from '@murmurations-ai/flyway-core'
import { callFlywayTool, listFlywayTools } from './handlers.js'

// eslint-disable-next-line @typescript-eslint/no-deprecated -- low-level Server API is intentional (see task constraints; do not migrate to McpServer)
export function createFlywayMcpServer(): Server {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- low-level Server API is intentional
  const server = new Server(
    {
      name: '@murmurations-ai/flyway-mcp',
      version: FLYWAY_PROTOCOL_VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => listFlywayTools())
  server.setRequestHandler(CallToolRequestSchema, (request) => callFlywayTool(request))

  return server
}

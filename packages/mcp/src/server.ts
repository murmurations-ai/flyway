import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { FLYWAY_PROTOCOL_VERSION } from '@murmurations-ai/flyway-core'
import { callFlywayTool, listFlywayTools } from './handlers.js'

export function createFlywayMcpServer(): Server {
  const server = new Server(
    {
      name: '@murmurations-ai/flyway-mcp',
      version: FLYWAY_PROTOCOL_VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => listFlywayTools())
  server.setRequestHandler(CallToolRequestSchema, (request) => callFlywayTool(request))

  return server
}

#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createFlywayMcpServer } from '../server.js'

const server = createFlywayMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)

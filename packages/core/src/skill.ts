import { FLYWAY_INSTRUCTIONS } from './instructions.js'
import { FLYWAY_TOOLS } from './tools.js'
import type { FlywaySkill } from './types.js'

export const FLYWAY_PROTOCOL_VERSION = '0.1.0'

export function createFlywaySkill(): FlywaySkill {
  return {
    version: FLYWAY_PROTOCOL_VERSION,
    tools: FLYWAY_TOOLS,
    instructions: FLYWAY_INSTRUCTIONS,
  }
}

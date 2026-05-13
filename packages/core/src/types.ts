export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'

export interface JsonSchema {
  type?: JsonSchemaType | readonly JsonSchemaType[]
  description?: string
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  items?: JsonSchema
  enum?: readonly unknown[]
  anyOf?: readonly JsonSchema[]
  oneOf?: readonly JsonSchema[]
}

export type FlywayToolName =
  | 'flyway_init'
  | 'flyway_status'
  | 'flyway_discover'
  | 'flyway_recognize'
  | 'flyway_tension'
  | 'flyway_propose'
  | 'flyway_respond'
  | 'flyway_check'
  | 'flyway_exit'

export interface FlywayToolDefinition {
  readonly name: FlywayToolName
  readonly description: string
  readonly inputSchema: JsonSchema
}

export interface FlywaySkill {
  readonly version: string
  readonly tools: readonly FlywayToolDefinition[]
  readonly instructions: string
}

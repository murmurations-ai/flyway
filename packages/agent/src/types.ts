import type { JsonSchema } from '@murmurations-ai/flyway-core'

// Anthropic tool use format
// https://docs.anthropic.com/en/docs/tool-use
export interface AnthropicTool {
  readonly name: string
  readonly description: string
  readonly input_schema: JsonSchema
}

// OpenAI function calling format
// https://platform.openai.com/docs/guides/function-calling
export interface OpenAIFunction {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: JsonSchema
    readonly strict?: boolean
  }
}

// Google Gemini function declaration format
// https://ai.google.dev/gemini-api/docs/function-calling
export interface GeminiFunctionDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchema
}

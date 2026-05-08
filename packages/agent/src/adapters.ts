import type { FlywaySkill, FlywayToolDefinition } from '@murmurations-ai/flyway-core'
import type { AnthropicTool, GeminiFunctionDeclaration, OpenAIFunction } from './types.js'

export function toAnthropicTools(tools: readonly FlywayToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function toOpenAITools(tools: readonly FlywayToolDefinition[]): OpenAIFunction[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: true,
    },
  }))
}

export function toGeminiTools(
  tools: readonly FlywayToolDefinition[],
): GeminiFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }))
}

/**
 * Renders the flyway skill as a markdown file suitable for loading into a
 * Claude Code skill directory (.claude/skills/flyway.md) or any agent
 * environment that accepts skills as markdown with YAML frontmatter.
 */
export function toSkillMarkdown(skill: FlywaySkill): string {
  const toolList = skill.tools
    .map((t) => `- **${t.name}**: ${t.description.split('.')[0]}.`)
    .join('\n')

  return `---
name: flyway
description: flyway protocol tools for cross-murmuration collaboration
version: ${skill.version}
---

${skill.instructions}

## Available tools

${toolList}
`
}

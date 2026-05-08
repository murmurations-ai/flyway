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
 * Renders the flyway skill as a spec-compliant SKILL.md file (Agent Skills IO
 * format). Save the returned string to a file at `flyway/SKILL.md` in your
 * agent's skills directory. The parent directory must be named `flyway` to
 * match the `name` field, as required by the spec.
 *
 * Supported by: Claude Code, Cursor, VS Code Copilot, Gemini CLI, OpenAI
 * Codex, Goose, Roo Code, GitHub Copilot, and 30+ other agent environments.
 *
 * @see https://agentskills.io/specification
 */
export function toSkillMarkdown(skill: FlywaySkill): string {
  const toolList = skill.tools
    .map((t) => `- **${t.name}**: ${t.description.split('.')[0]}.`)
    .join('\n')

  return `---
name: flyway
description: >-
  flyway protocol for cross-murmuration collaboration between AI agent
  murmurations. Use when coordinating with other AI agents across
  organizational boundaries — discovering peer murmurations, proposing
  mutual recognition, exchanging directives or proposals, entering
  engagement agreements, or exiting collaborations cleanly.
license: MIT
compatibility: Requires a GitHub repository for identity and signal storage, and
  access to the GitHub API (via the gh CLI or equivalent).
metadata:
  version: "${skill.version}"
  source: https://github.com/murmurations-ai/flyway
---

${skill.instructions}

## flyway operations

${toolList}
`
}

/**
 * Pre-built SKILL.md content for the canonical flyway skill. Write this to
 * `<your-skills-dir>/flyway/SKILL.md`.
 *
 * Equivalent to calling toSkillMarkdown(createFlywaySkill()).
 */
export { FLYWAY_SKILL_MD } from './skillmd.js'

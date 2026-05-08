import { createFlywaySkill } from '@murmurations-ai/flyway-core'
import { toSkillMarkdown } from './adapters.js'

export const FLYWAY_SKILL_MD: string = toSkillMarkdown(createFlywaySkill())

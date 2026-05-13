import { describe, expect, it } from 'vitest'
import {
  FLYWAY_AGREEMENT_SCHEMA,
  FLYWAY_AGREEMENT_SCHEMA_VERSION,
  FLYWAY_AGREEMENT_STATES,
  FLYWAY_DECISION_RULES,
} from './agreements.js'

describe('FLYWAY_AGREEMENT_SCHEMA', () => {
  it('has the eleven load-bearing required fields', () => {
    expect(FLYWAY_AGREEMENT_SCHEMA.required).toEqual([
      'id',
      'schemaVersion',
      'createdAt',
      'participants',
      'driver',
      'purpose',
      'expectations',
      'decisionRule',
      'review',
      'exit',
      'state',
    ])
  })

  it('driver subfield carries the S3 §IV.1.3 three-part shape', () => {
    const driver = FLYWAY_AGREEMENT_SCHEMA.properties?.['driver']
    expect(driver?.properties).toHaveProperty('conditions')
    expect(driver?.properties).toHaveProperty('effect')
    expect(driver?.properties).toHaveProperty('relevance')
    expect(driver?.required).toEqual(['conditions', 'effect'])
  })

  it('decisionRule enum matches the five rules in consent-mechanisms.md', () => {
    const decisionRule = FLYWAY_AGREEMENT_SCHEMA.properties?.['decisionRule']
    expect(decisionRule?.enum).toEqual(FLYWAY_DECISION_RULES)
  })

  it('state enum covers the full lifecycle', () => {
    const state = FLYWAY_AGREEMENT_SCHEMA.properties?.['state']
    expect(state?.enum).toEqual(FLYWAY_AGREEMENT_STATES)
  })

  it('review requires cadence (S3 §IV.7.1 regular review meetings)', () => {
    const review = FLYWAY_AGREEMENT_SCHEMA.properties?.['review']
    expect(review?.required).toEqual(['cadence'])
  })

  it('exit requires notice (S3 §IV.7.1 termination protocol)', () => {
    const exit = FLYWAY_AGREEMENT_SCHEMA.properties?.['exit']
    expect(exit?.required).toEqual(['notice'])
  })

  it('signatures items require participant, signedAt, signature', () => {
    const signatures = FLYWAY_AGREEMENT_SCHEMA.properties?.['signatures']
    expect(signatures?.items?.required).toEqual([
      'participant',
      'signedAt',
      'signature',
    ])
  })
})

describe('FLYWAY_DECISION_RULES', () => {
  it('contains exactly the five rules from consent-mechanisms.md', () => {
    expect(FLYWAY_DECISION_RULES).toEqual([
      's3-consent',
      'lazy-consent',
      'dual-source-sign',
      'weighted-vote-bounded',
      'apache-vote',
    ])
  })

  it('s3-consent comes first (the default)', () => {
    expect(FLYWAY_DECISION_RULES[0]).toBe('s3-consent')
  })
})

describe('FLYWAY_AGREEMENT_STATES', () => {
  it('models a forward lifecycle: proposed → agreed → in-flight → closed', () => {
    expect(FLYWAY_AGREEMENT_STATES).toContain('proposed')
    expect(FLYWAY_AGREEMENT_STATES).toContain('agreed')
    expect(FLYWAY_AGREEMENT_STATES).toContain('in-flight')
    expect(FLYWAY_AGREEMENT_STATES).toContain('closed')
  })

  it('includes suspended for paused-by-mutual-consent', () => {
    expect(FLYWAY_AGREEMENT_STATES).toContain('suspended')
  })
})

describe('FLYWAY_AGREEMENT_SCHEMA_VERSION', () => {
  it('is a semver-shaped string', () => {
    expect(FLYWAY_AGREEMENT_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

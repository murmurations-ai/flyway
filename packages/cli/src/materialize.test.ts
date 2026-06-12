import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type FlywayAgreement,
  FLYWAY_AGREEMENT_SCHEMA_VERSION,
  flywayStatus,
} from '@murmurations-ai/flyway-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'
import { runMaterialize } from './materialize.js'
import { runPropose } from './propose.js'
import { runRecognize } from './recognize.js'
import { runRespond } from './respond.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-materialize-test-'))
}

interface Pair {
  a: string
  b: string
  aDid: string
  bDid: string
}

async function bootstrapRecognizedPair(): Promise<Pair> {
  const a = freshTmp()
  const b = freshTmp()
  const { did: aDid } = await runInit({
    repoUrl: 'https://github.com/xeeban/a',
    sourceName: 'A Source',
    mode: 'interactive',
    cwd: a,
  })
  const { did: bDid } = await runInit({
    repoUrl: 'https://github.com/xeeban/b',
    sourceName: 'B Source',
    mode: 'interactive',
    cwd: b,
  })
  await runRecognize({ cwd: a, peerRepoPath: b })
  await runRecognize({ cwd: b, peerRepoPath: a })
  return { a, b, aDid, bDid }
}

function exampleAgreement(participants: readonly string[]): FlywayAgreement {
  return {
    id: 'agreement-cli-001',
    schemaVersion: FLYWAY_AGREEMENT_SCHEMA_VERSION,
    createdAt: '2026-06-09T12:00:00.000Z',
    participants,
    driver: {
      conditions: 'Sprint retrospectives are running over.',
      effect: 'Cross-circle tensions surface in governance rounds instead.',
    },
    purpose: 'Hold weekly retros that surface tensions before they reach governance.',
    expectations: participants.map((p) => ({
      participant: p,
      description: 'Attend the weekly retro at the agreed cadence.',
    })),
    decisionRule: 's3-consent',
    review: { cadence: 'monthly' },
    exit: { notice: '30 days' },
    state: 'proposed',
  }
}

/** A proposes the final agreement to B; B accepts. Returns the two signal ids. */
async function consentClose(pair: Pair): Promise<{ proposalId: string; responseId: string }> {
  const proposed = await runPropose({
    cwd: pair.a,
    peerRepoPath: pair.b,
    body: {
      type: 'agreement',
      title: 'Weekly retro cadence',
      body: 'Final form of the retro cadence agreement.',
      stage: 'final',
      agreement: exampleAgreement([pair.aDid, pair.bDid]),
    },
  })
  const responded = await runRespond({
    cwd: pair.b,
    peerRepoPath: pair.a,
    subjectId: proposed.proposal.id,
    decision: 'accept',
  })
  return { proposalId: proposed.proposal.id, responseId: responded.response.id }
}

describe('runMaterialize', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('both participants materialize byte-identical agreement files', async () => {
    const { responseId } = await consentClose(pair)

    // A materializes from its records (proposal in outbox, accept in inbox).
    const fromA = await runMaterialize({
      cwd: pair.a,
      peerRepoPath: pair.b,
      responseId,
    })
    // B materializes from its records (proposal in inbox, accept in outbox).
    const fromB = await runMaterialize({
      cwd: pair.b,
      peerRepoPath: pair.a,
      responseId,
    })

    expect(fromA.created).toBe(true)
    expect(fromB.created).toBe(true)
    expect(fromA.materialized.sha256).toBe(fromB.materialized.sha256)
    const bytesA = readFileSync(fromA.path, 'utf-8')
    const bytesB = readFileSync(fromB.path, 'utf-8')
    expect(bytesA).toBe(bytesB)
    expect(fromA.path).toBe(join(pair.a, 'flyway', 'agreements', 'agreement-cli-001.yaml'))
    expect(fromB.path).toBe(join(pair.b, 'flyway', 'agreements', 'agreement-cli-001.yaml'))
  })

  it('resolves the proposal id from the response refs when --proposal-id is omitted', async () => {
    const { proposalId, responseId } = await consentClose(pair)
    const result = await runMaterialize({
      cwd: pair.a,
      peerRepoPath: pair.b,
      responseId,
    })
    expect(result.materialized.agreement.state).toBe('agreed')
    // And explicitly supplying it produces the same result.
    const explicit = await runMaterialize({
      cwd: pair.a,
      peerRepoPath: pair.b,
      responseId,
      proposalId,
    })
    expect(explicit.materialized.sha256).toBe(result.materialized.sha256)
    expect(explicit.created).toBe(false) // identical bytes already on file
  })

  it('the materialized agreement shows up in flyway_status', async () => {
    const { responseId } = await consentClose(pair)
    await runMaterialize({ cwd: pair.a, peerRepoPath: pair.b, responseId })
    const status = await flywayStatus(pair.a)
    expect(status.agreements.count).toBe(1)
    expect(status.agreements.ids).toContain('agreement-cli-001')
  })

  it('refuses when the response was an objection', async () => {
    const proposed = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'agreement',
        title: 'Weekly retro cadence',
        body: 'Final form of the retro cadence agreement.',
        stage: 'final',
        agreement: exampleAgreement([pair.aDid, pair.bDid]),
      },
    })
    const objected = await runRespond({
      cwd: pair.b,
      peerRepoPath: pair.a,
      subjectId: proposed.proposal.id,
      decision: 'object',
      reason: 'Cadence conflicts with our sprint rhythm.',
    })
    await expect(
      runMaterialize({
        cwd: pair.a,
        peerRepoPath: pair.b,
        responseId: objected.response.id,
      }),
    ).rejects.toThrow(/decision must be 'accept'/)
  })

  it('refuses an unknown response id', async () => {
    await consentClose(pair)
    await expect(
      runMaterialize({
        cwd: pair.a,
        peerRepoPath: pair.b,
        responseId: 'no-such-signal',
      }),
    ).rejects.toThrow(/no signal with id/)
  })

  it('refuses an unrecognized peer', async () => {
    const { responseId } = await consentClose(pair)
    const stranger = freshTmp()
    try {
      await runInit({
        repoUrl: 'https://github.com/xeeban/stranger',
        sourceName: 'Stranger',
        mode: 'interactive',
        cwd: stranger,
      })
      await expect(
        runMaterialize({
          cwd: pair.a,
          peerRepoPath: stranger,
          responseId,
        }),
      ).rejects.toThrow(/not recognized/)
    } finally {
      rmSync(stranger, { recursive: true, force: true })
    }
  })
})

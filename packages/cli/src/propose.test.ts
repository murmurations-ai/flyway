import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flywayCheck, readSignalFile } from '@murmurations-ai/flyway-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'
import { runPropose } from './propose.js'
import { runRecognize } from './recognize.js'
import { runTension } from './tension.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-propose-test-'))
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

describe('runPropose — happy path', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('writes a signed directive proposal to both outbox and inbox', async () => {
    const result = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'directive',
        title: 'Send weekly status digest',
        body: 'Please send the project digest every Friday at 17:00 UTC.',
      },
    })
    expect(result.proposal.kind).toBe('proposal')
    expect(result.proposal.from).toBe(pair.aDid)
    expect(result.proposal.to).toBe(pair.bDid)
    expect(existsSync(result.outboxPath)).toBe(true)
    expect(existsSync(result.inboxPath)).toBe(true)
  })

  it("B's flyway_check verifies the delivered proposal", async () => {
    await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'directive',
        title: 'Send weekly status digest',
        body: 'Please send the project digest every Friday at 17:00 UTC.',
      },
    })
    const inbox = await flywayCheck(pair.b)
    expect(inbox.totalCount).toBe(1)
    expect(inbox.validCount).toBe(1)
    expect(inbox.signals[0]?.envelope.kind).toBe('proposal')
  })

  it('promotes a tension we previously sent into a proposal with refs.tensionId', async () => {
    // A sends tension → B
    const t = await runTension({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: { conditions: 'X', effect: 'Y' },
    })
    // A then promotes that tension into a proposal back to B
    const result = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'directive',
        title: 'Schedule the retro',
        body: 'In response to the tension I surfaced.',
      },
      promoteTensionId: t.signal.id,
    })
    expect(result.proposal.refs?.tensionId).toBe(t.signal.id)
  })

  it('promotes a tension we received from a peer', async () => {
    // B sends tension → A
    const t = await runTension({
      cwd: pair.b,
      peerRepoPath: pair.a,
      body: { conditions: 'X from B', effect: 'Y' },
    })
    // A picks up B's tension and proposes back to B
    const result = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'directive',
        title: 'Picking up your tension',
        body: 'Here is what I propose.',
      },
      promoteTensionId: t.signal.id,
    })
    expect(result.proposal.refs?.tensionId).toBe(t.signal.id)
  })

  it('chains through stages with previousStageId', async () => {
    const driver = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'directive',
        title: 'Driver',
        body: 'Surface the driver.',
        stage: 'driver',
      },
    })
    const draft = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'directive',
        title: 'Draft',
        body: 'Draft proposal.',
        stage: 'draft',
      },
      previousStageId: driver.proposal.id,
    })
    expect(draft.proposal.refs?.proposalId).toBe(driver.proposal.id)
  })

  it('round-trips an agreement proposal', async () => {
    const result = await runPropose({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        type: 'agreement',
        title: 'Weekly retro agreement',
        body: 'Structured agreement attached.',
        agreement: {
          id: 'ag-1',
          schemaVersion: '0.1.0',
          createdAt: '2026-05-26T12:00:00.000Z',
          participants: [pair.aDid, pair.bDid],
          driver: { conditions: 'Long retros', effect: 'Tensions surface in governance' },
          purpose: 'Hold retros',
          expectations: [
            { participant: pair.aDid, description: 'attend' },
            { participant: pair.bDid, description: 'attend' },
          ],
          decisionRule: 's3-consent',
          review: { cadence: 'monthly' },
          exit: { notice: '30 days' },
          state: 'proposed',
        },
      },
    })
    const stored = readSignalFile(result.outboxPath)
    expect(stored).not.toBeNull()
    const body = stored?.body as { agreement: { id: string } }
    expect(body.agreement.id).toBe('ag-1')
  })
})

describe('runPropose — refuses unsafe operations', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('refuses to send to an unrecognized peer', async () => {
    const c = freshTmp()
    try {
      await runInit({
        repoUrl: 'https://github.com/xeeban/c',
        sourceName: 'C',
        mode: 'interactive',
        cwd: c,
      })
      await expect(
        runPropose({
          cwd: pair.a,
          peerRepoPath: c,
          body: {
            type: 'directive',
            title: 'X',
            body: 'Y',
          },
        }),
      ).rejects.toThrow(/not recognized/)
    } finally {
      rmSync(c, { recursive: true, force: true })
    }
  })

  it('refuses promotion of a non-existent tension id', async () => {
    await expect(
      runPropose({
        cwd: pair.a,
        peerRepoPath: pair.b,
        body: {
          type: 'directive',
          title: 'X',
          body: 'Y',
        },
        promoteTensionId: 'no-such-tension',
      }),
    ).rejects.toThrow(/not found in our inbox or outbox/)
  })

  it('refuses chain continuation pointing at no-such-proposal', async () => {
    await expect(
      runPropose({
        cwd: pair.a,
        peerRepoPath: pair.b,
        body: {
          type: 'directive',
          title: 'X',
          body: 'Y',
          stage: 'refinement',
        },
        previousStageId: 'no-such-proposal',
      }),
    ).rejects.toThrow(/not found in our outbox/)
  })
})

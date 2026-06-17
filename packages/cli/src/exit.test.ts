import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flywayCheck } from '@murmurations-ai/flyway-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runExit } from './exit.js'
import { runInit } from './init.js'
import { runRecognize } from './recognize.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-exit-test-'))
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

describe('runExit', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('delivers a signed peer-exit and B verifies it via flyway_check', async () => {
    const result = await runExit({
      cwd: pair.a,
      peerRepoPath: pair.b,
      targetType: 'peer',
      reason: 'Winding the collaboration down amicably.',
    })
    expect(result.signal.kind).toBe('exit')
    expect(result.peerDid).toBe(pair.bDid)
    // target defaults to the peer DID for a peer exit.
    expect((result.signal.body as { target: string }).target).toBe(pair.bDid)

    const inbox = await flywayCheck(pair.b)
    expect(inbox.totalCount).toBe(1)
    expect(inbox.validCount).toBe(1)
    expect(inbox.signals[0]?.envelope.kind).toBe('exit')
  })

  it('writes the exit to both outbox and inbox', async () => {
    const result = await runExit({
      cwd: pair.a,
      peerRepoPath: pair.b,
      targetType: 'project',
      target: 'retro-cadence-2026',
    })
    expect(result.outboxPath).toContain(join(pair.a, 'flyway', 'outbox'))
    expect(result.inboxPath).toContain(join(pair.b, 'flyway', 'inbox'))
    const body = result.signal.body as { target: string; targetType: string }
    expect(body.target).toBe('retro-cadence-2026')
    expect(body.targetType).toBe('project')
  })

  it('does not retract recognition — the peer stays in peers.yaml after exit', async () => {
    await runExit({ cwd: pair.a, peerRepoPath: pair.b, targetType: 'peer' })
    // A can still send another exit (e.g. for a project) — proof the
    // relationship record is intact; exit is not unrecognition.
    await expect(
      runExit({
        cwd: pair.a,
        peerRepoPath: pair.b,
        targetType: 'project',
        target: 'another-project',
      }),
    ).resolves.toBeDefined()
  })

  it('refuses --target-type project without a target', async () => {
    await expect(
      runExit({ cwd: pair.a, peerRepoPath: pair.b, targetType: 'project' }),
    ).rejects.toThrow(/--target is required/)
  })

  it('refuses to exit an unrecognized peer', async () => {
    const stranger = freshTmp()
    try {
      await runInit({
        repoUrl: 'https://github.com/xeeban/stranger',
        sourceName: 'Stranger',
        mode: 'interactive',
        cwd: stranger,
      })
      await expect(
        runExit({ cwd: pair.a, peerRepoPath: stranger, targetType: 'peer' }),
      ).rejects.toThrow(/not recognized/)
    } finally {
      rmSync(stranger, { recursive: true, force: true })
    }
  })
})

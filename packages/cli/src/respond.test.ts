import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flywayCheck, readSignalFile } from '@murmurations-ai/flyway-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'
import { runRecognize } from './recognize.js'
import { runRespond } from './respond.js'
import { runTension } from './tension.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-respond-test-'))
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

async function flagTensionAtoB(pair: Pair): Promise<{ subjectId: string }> {
  const result = await runTension({
    cwd: pair.a,
    peerRepoPath: pair.b,
    body: { conditions: 'X', effect: 'Y' },
  })
  return { subjectId: result.signal.id }
}

describe('runRespond — happy path', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('B can acknowledge A and the response lands in A’s inbox verifiable', async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    const result = await runRespond({
      cwd: pair.b,
      peerRepoPath: pair.a,
      subjectId,
      decision: 'acknowledge',
    })
    expect(result.response.kind).toBe('respond')
    expect(result.response.from).toBe(pair.bDid)
    expect(result.response.to).toBe(pair.aDid)
    expect(result.response.refs?.tensionId).toBe(subjectId)
    expect(existsSync(result.outboxPath)).toBe(true)
    expect(existsSync(result.inboxPath)).toBe(true)

    // A's flyway_check sees the response and verifies it.
    const aInbox = await flywayCheck(pair.a)
    expect(aInbox.totalCount).toBe(1)
    expect(aInbox.validCount).toBe(1)
    expect(aInbox.signals[0]?.envelope.kind).toBe('respond')
    expect((aInbox.signals[0]?.envelope.body as { decision: string }).decision).toBe('acknowledge')
  })

  it('B can transfer a tension with explicit transferTo + reason', async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    const result = await runRespond({
      cwd: pair.b,
      peerRepoPath: pair.a,
      subjectId,
      decision: 'transfer',
      reason: 'Belongs in the platform circle',
      transferTo: 'did:web:github.com:third:party',
    })
    const body = result.response.body as Record<string, unknown>
    expect(body.decision).toBe('transfer')
    expect(body.reason).toBe('Belongs in the platform circle')
    expect(body.transferTo).toBe('did:web:github.com:third:party')
  })

  it('B can dispute a tension and the body round-trips through disk', async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    const result = await runRespond({
      cwd: pair.b,
      peerRepoPath: pair.a,
      subjectId,
      decision: 'dispute',
      reason: "Not a driver — this resolved in last week's retro",
    })
    const reread = readSignalFile(result.inboxPath)
    expect(reread).not.toBeNull()
    const body = reread?.body as Record<string, unknown>
    expect(body.decision).toBe('dispute')
    expect(body.reason).toBe("Not a driver — this resolved in last week's retro")
  })
})

describe('runRespond — refuses unsafe operations', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it("refuses when no signal with that id is in B's inbox", async () => {
    // No prior tension. Just try to respond to a fictitious id.
    await expect(
      runRespond({
        cwd: pair.b,
        peerRepoPath: pair.a,
        subjectId: 'nonexistent',
        decision: 'acknowledge',
      }),
    ).rejects.toThrow(/no signal with id/)
  })

  it("refuses when the subject's sender doesn't match peer-repo-path", async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    // Bootstrap a third murmuration C that B has recognized.
    const c = freshTmp()
    try {
      await runInit({
        repoUrl: 'https://github.com/xeeban/c',
        sourceName: 'C',
        mode: 'interactive',
        cwd: c,
      })
      await runRecognize({ cwd: pair.b, peerRepoPath: c })
      // Now B tries to "respond to A's tension" but pointing at C.
      await expect(
        runRespond({
          cwd: pair.b,
          peerRepoPath: c,
          subjectId,
          decision: 'acknowledge',
        }),
      ).rejects.toThrow(/peer-repo-path resolves to/)
    } finally {
      rmSync(c, { recursive: true, force: true })
    }
  })

  it('refuses to respond to a peer not in our peers.yaml', async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    // C is a stranger from B's perspective.
    const c = freshTmp()
    try {
      await runInit({
        repoUrl: 'https://github.com/xeeban/c',
        sourceName: 'C',
        mode: 'interactive',
        cwd: c,
      })
      // peer-repo-path = C, but B never recognized C and the subject is
      // from A, so the unrecognized-peer error fires first (before the
      // subject-sender mismatch check).
      await expect(
        runRespond({
          cwd: pair.b,
          peerRepoPath: c,
          subjectId,
          decision: 'acknowledge',
        }),
      ).rejects.toThrow(/not recognized/)
    } finally {
      rmSync(c, { recursive: true, force: true })
    }
  })

  it('refuses when validation of the response body fails (dispute with no reason)', async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    await expect(
      runRespond({
        cwd: pair.b,
        peerRepoPath: pair.a,
        subjectId,
        decision: 'dispute',
      }),
    ).rejects.toThrow(/requires a non-empty reason/)
  })

  it('refuses to respond to a tampered subject signal', async () => {
    const { subjectId } = await flagTensionAtoB(pair)
    // Tamper with the subject envelope in B's inbox.
    const inboxFile = join(
      pair.b,
      'flyway',
      'inbox',
      'github.com',
      'xeeban',
      'a',
      `${subjectId}.yaml`,
    )
    const original = readFileSync(inboxFile, 'utf-8')
    writeFileSync(inboxFile, original.replace('conditions: X', 'conditions: TAMPERED'))
    await expect(
      runRespond({
        cwd: pair.b,
        peerRepoPath: pair.a,
        subjectId,
        decision: 'acknowledge',
      }),
    ).rejects.toThrow(/tampered or stale tension|does not verify/)
  })
})

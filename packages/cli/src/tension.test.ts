import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flywayCheck } from '@murmurations-ai/flyway-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'
import { runRecognize } from './recognize.js'
import { runTension } from './tension.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-tension-test-'))
}

interface Pair {
  a: string
  b: string
  aDid: string
  bDid: string
}

async function bootstrapPair(): Promise<Pair> {
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
  return { a, b, aDid, bDid }
}

async function bootstrapRecognizedPair(): Promise<Pair> {
  const pair = await bootstrapPair()
  await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
  await runRecognize({ cwd: pair.b, peerRepoPath: pair.a })
  return pair
}

describe('runTension — happy path', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapRecognizedPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('writes signed envelopes to both the sender outbox and the recipient inbox', async () => {
    const result = await runTension({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        conditions: 'Sprint reviews are running 90 minutes over.',
        effect: 'Retrospectives are getting compressed or skipped.',
      },
    })
    expect(result.peerDid).toBe(pair.bDid)
    expect(result.signal.from).toBe(pair.aDid)
    expect(result.signal.to).toBe(pair.bDid)
    expect(result.signal.kind).toBe('tension')
    expect(existsSync(result.outboxPath)).toBe(true)
    expect(existsSync(result.inboxPath)).toBe(true)
    // The two files are byte-identical (same signed envelope, same headers
    // would differ — but the YAML body after the header should match).
    const outYaml = readFileSync(result.outboxPath, 'utf-8')
    const inYaml = readFileSync(result.inboxPath, 'utf-8')
    expect(outYaml).toContain(`id: ${result.signal.id}`)
    expect(inYaml).toContain(`id: ${result.signal.id}`)
  })

  it("the recipient's flyway_check verifies the delivered envelope", async () => {
    await runTension({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: { conditions: 'X', effect: 'Y' },
    })
    const inbox = await flywayCheck(pair.b)
    expect(inbox.totalCount).toBe(1)
    expect(inbox.validCount).toBe(1)
    expect(inbox.signals[0]?.signatureValid).toBe(true)
    expect(inbox.signals[0]?.fromRecognized).toBe(true)
    expect(inbox.signals[0]?.envelope.kind).toBe('tension')
  })

  it('passes through optional body fields', async () => {
    const result = await runTension({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: {
        conditions: 'X',
        effect: 'Y',
        relevance: 'Z',
        proposedOwner: 'did:web:github.com:third:party',
      },
    })
    const body = result.signal.body as Record<string, unknown>
    expect(body.relevance).toBe('Z')
    expect(body.proposedOwner).toBe('did:web:github.com:third:party')
  })

  it('passes through refs (links to a prior tension)', async () => {
    const result = await runTension({
      cwd: pair.a,
      peerRepoPath: pair.b,
      body: { conditions: 'X', effect: 'Y' },
      refs: { inReplyTo: 'earlier-signal-id' },
    })
    expect(result.signal.refs?.inReplyTo).toBe('earlier-signal-id')
  })
})

describe('runTension — refuses unsafe operations', () => {
  let pair: Pair
  beforeEach(async () => {
    pair = await bootstrapPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('refuses to send to an unrecognized peer', async () => {
    // No prior runRecognize.
    await expect(
      runTension({
        cwd: pair.a,
        peerRepoPath: pair.b,
        body: { conditions: 'X', effect: 'Y' },
      }),
    ).rejects.toThrow(/not recognized/)
  })

  it("refuses if our identity hasn't been initialized", async () => {
    const empty = freshTmp()
    try {
      await expect(
        runTension({
          cwd: empty,
          peerRepoPath: pair.b,
          body: { conditions: 'X', effect: 'Y' },
        }),
      ).rejects.toThrow(/flyway init/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("refuses if the peer repo hasn't been initialized", async () => {
    await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    const empty = freshTmp()
    try {
      await expect(
        runTension({
          cwd: pair.a,
          peerRepoPath: empty,
          body: { conditions: 'X', effect: 'Y' },
        }),
      ).rejects.toThrow(/peer DID document missing/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('rejects empty conditions (validation lives in core)', async () => {
    await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    await expect(
      runTension({
        cwd: pair.a,
        peerRepoPath: pair.b,
        body: { conditions: '', effect: 'Y' },
      }),
    ).rejects.toThrow(/conditions/)
  })
})

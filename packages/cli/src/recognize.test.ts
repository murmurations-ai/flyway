import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flywayStatus } from '@murmurations-ai/flyway-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'
import { readPeersFile, runRecognize } from './recognize.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-recognize-test-'))
}

async function bootstrapPair(): Promise<{ a: string; b: string; aDid: string; bDid: string }> {
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

describe('runRecognize — happy path', () => {
  let pair: { a: string; b: string; aDid: string; bDid: string }
  beforeEach(async () => {
    pair = await bootstrapPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('writes a signed recognition entry and a peer cache', async () => {
    const result = await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    expect(result.peerDid).toBe(pair.bDid)
    expect(result.entry.recognizedBy).toBe(pair.aDid)
    expect(result.entry.signature.domain).toBe('flyway-v1:recognition')
    expect(existsSync(join(pair.a, 'flyway', 'peers.yaml'))).toBe(true)
    expect(
      existsSync(join(pair.a, 'flyway', 'peers', 'github.com', 'xeeban', 'b', 'did.json')),
    ).toBe(true)
    expect(
      existsSync(
        join(pair.a, 'flyway', 'peers', 'github.com', 'xeeban', 'b', 'entity-statement.json'),
      ),
    ).toBe(true)
  })

  it('the recognition entry round-trips through peers.yaml unchanged', async () => {
    const { entry } = await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    const file = readPeersFile(join(pair.a, 'flyway', 'peers.yaml'))
    expect(file.peers).toHaveLength(1)
    expect(file.peers[0]?.signature.signature).toBe(entry.signature.signature)
  })

  it('records an optional note when provided', async () => {
    const { entry } = await runRecognize({
      cwd: pair.a,
      peerRepoPath: pair.b,
      note: 'Met via S3 walkthrough',
    })
    expect(entry.note).toBe('Met via S3 walkthrough')
  })

  it('reflects the new peer in flyway_status', async () => {
    await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    const status = await flywayStatus(pair.a)
    expect(status.peers.present).toBe(true)
    expect(status.peers.count).toBe(1)
    expect(status.peers.entries[0]?.did).toBe(pair.bDid)
    expect(status.peers.entries[0]?.recognitionValid).toBe(true)
  })
})

describe('runRecognize — refuses unsafe operations', () => {
  let pair: { a: string; b: string; aDid: string; bDid: string }
  beforeEach(async () => {
    pair = await bootstrapPair()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('refuses to re-recognize the same peer without --force', async () => {
    await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    await expect(
      runRecognize({ cwd: pair.a, peerRepoPath: pair.b }),
    ).rejects.toThrow(/already recognized/)
  })

  it('replaces the prior entry when --force is set', async () => {
    const first = await runRecognize({ cwd: pair.a, peerRepoPath: pair.b })
    const second = await runRecognize({ cwd: pair.a, peerRepoPath: pair.b, force: true })
    expect(second.replacedPriorEntry).toBe(true)
    // recognizedAt should advance (or at least the signature is fresh)
    const file = readPeersFile(join(pair.a, 'flyway', 'peers.yaml'))
    expect(file.peers).toHaveLength(1)
    expect(file.peers[0]?.did).toBe(first.peerDid)
  })

  it("refuses if our identity hasn't been initialized", async () => {
    const empty = freshTmp()
    try {
      await expect(
        runRecognize({ cwd: empty, peerRepoPath: pair.b }),
      ).rejects.toThrow(/flyway init/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("refuses if the peer repo hasn't been initialized", async () => {
    const empty = freshTmp()
    try {
      await expect(
        runRecognize({ cwd: pair.a, peerRepoPath: empty }),
      ).rejects.toThrow(/peer .* missing/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('refuses to recognize self', async () => {
    await expect(
      runRecognize({ cwd: pair.a, peerRepoPath: pair.a }),
    ).rejects.toThrow(/cannot recognize self/)
  })

  it('refuses to recognize when peer entity statement is tampered', async () => {
    const stmtPath = join(pair.b, 'flyway', 'entity-statement.json')
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8'))
    stmt.sourceName = 'Imposter'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(stmtPath, JSON.stringify(stmt, null, 2))
    await expect(
      runRecognize({ cwd: pair.a, peerRepoPath: pair.b }),
    ).rejects.toThrow(/does not verify/)
  })
})

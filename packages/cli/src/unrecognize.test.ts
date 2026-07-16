import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type DidDocument,
  flywayStatus,
  verifyUnrecognitionRecord,
} from '@murmurations-ai/flyway-core'
import { parseDocument } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'
import { readPeersFile, runRecognize } from './recognize.js'
import { runUnrecognize } from './unrecognize.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-unrecognize-test-'))
}

async function bootstrapPairWithRecognition(): Promise<{
  a: string
  b: string
  aDid: string
  bDid: string
}> {
  const a = freshTmp()
  const b = freshTmp()
  const { did: aDid } = await runInit({
    repoUrl: 'https://github.com/xeeban/a',
    sourceName: 'A',
    mode: 'interactive',
    cwd: a,
  })
  const { did: bDid } = await runInit({
    repoUrl: 'https://github.com/xeeban/b',
    sourceName: 'B',
    mode: 'interactive',
    cwd: b,
  })
  await runRecognize({ cwd: a, peerRepoPath: b })
  return { a, b, aDid, bDid }
}

describe('runUnrecognize', () => {
  let pair: { a: string; b: string; aDid: string; bDid: string }
  beforeEach(async () => {
    pair = await bootstrapPairWithRecognition()
  })
  afterEach(() => {
    rmSync(pair.a, { recursive: true, force: true })
    rmSync(pair.b, { recursive: true, force: true })
  })

  it('removes the peer from peers.yaml and writes a signed unrecognition record', async () => {
    const result = await runUnrecognize({
      cwd: pair.a,
      peerDid: pair.bDid,
      reason: 'Engagement concluded',
    })
    expect(result.peerDid).toBe(pair.bDid)
    expect(existsSync(result.recordPath)).toBe(true)
    const peers = readPeersFile(join(pair.a, 'flyway', 'peers.yaml'))
    expect(peers.peers).toHaveLength(0)
  })

  it('the unrecognition record verifies against our DID document', async () => {
    const result = await runUnrecognize({ cwd: pair.a, peerDid: pair.bDid })
    const didDoc = JSON.parse(
      readFileSync(join(pair.a, '.well-known', 'did.json'), 'utf-8'),
    ) as DidDocument
    const ok = await verifyUnrecognitionRecord(result.record, didDoc)
    expect(ok).toBe(true)
  })

  it('the unrecognition record YAML round-trips and carries the reason', async () => {
    await runUnrecognize({ cwd: pair.a, peerDid: pair.bDid, reason: 'Tested' })
    const safeDid = pair.bDid.replace(/[:/]/g, '_')
    const recordYaml = readFileSync(
      join(pair.a, 'flyway', 'unrecognized', `${safeDid}.yaml`),
      'utf-8',
    )
    const record = parseDocument(recordYaml).toJS() as { peer: string; reason?: string }
    expect(record.peer).toBe(pair.bDid)
    expect(record.reason).toBe('Tested')
  })

  it('leaves the peer cache intact for audit', async () => {
    await runUnrecognize({ cwd: pair.a, peerDid: pair.bDid })
    const cacheDir = join(pair.a, 'flyway', 'peers', 'github.com', 'xeeban', 'b')
    expect(existsSync(join(cacheDir, 'did.json'))).toBe(true)
    expect(existsSync(join(cacheDir, 'entity-statement.json'))).toBe(true)
  })

  it('flyway status no longer lists the peer after unrecognize', async () => {
    await runUnrecognize({ cwd: pair.a, peerDid: pair.bDid })
    const status = await flywayStatus(pair.a)
    expect(status.peers.count).toBe(0)
  })

  it('refuses to unrecognize a peer that is not currently recognized', async () => {
    await runUnrecognize({ cwd: pair.a, peerDid: pair.bDid })
    await expect(runUnrecognize({ cwd: pair.a, peerDid: pair.bDid })).rejects.toThrow(
      /not currently in/,
    )
  })

  it('refuses when our identity has not been initialized', async () => {
    const empty = freshTmp()
    try {
      await expect(runUnrecognize({ cwd: empty, peerDid: pair.bDid })).rejects.toThrow(
        /flyway init/,
      )
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

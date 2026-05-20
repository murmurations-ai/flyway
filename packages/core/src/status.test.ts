import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import { flywayStatus } from './status.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-status-test-'))
}

async function seedIdentity(cwd: string): Promise<{ did: string }> {
  const artifacts = await flywayInit({
    repoUrl: 'https://github.com/xeeban/flyway',
    sourceName: 'Nori',
    mode: 'interactive',
  })
  mkdirSync(join(cwd, '.well-known'), { recursive: true })
  mkdirSync(join(cwd, 'flyway', 'keys'), { recursive: true })
  writeFileSync(
    join(cwd, '.well-known', 'did.json'),
    JSON.stringify(artifacts.didDocument, null, 2),
  )
  writeFileSync(
    join(cwd, 'flyway', 'entity-statement.json'),
    JSON.stringify(artifacts.entityStatement, null, 2),
  )
  writeFileSync(join(cwd, 'flyway', 'keys', 'source.key'), artifacts.keypair.privateKeyPem)
  return { did: artifacts.did }
}

describe('flywayStatus — empty directory', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports identity as uninitialized when no flyway files exist', async () => {
    const status = await flywayStatus(tmp)
    expect(status.identity.initialized).toBe(false)
    expect(status.identity.issues[0]).toMatch(/no flyway identity/)
  })

  it('reports peers as absent', async () => {
    const status = await flywayStatus(tmp)
    expect(status.peers.present).toBe(false)
  })

  it('reports zero agreements', async () => {
    const status = await flywayStatus(tmp)
    expect(status.agreements.count).toBe(0)
    expect(status.agreements.ids).toEqual([])
  })
})

describe('flywayStatus — healthy initialized identity', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports the DID, source name, and mode from the entity statement', async () => {
    const { did } = await seedIdentity(tmp)
    const status = await flywayStatus(tmp)
    expect(status.identity.initialized).toBe(true)
    expect(status.identity.did).toBe(did)
    expect(status.identity.sourceName).toBe('Nori')
    expect(status.identity.mode).toBe('interactive')
  })

  it('verifies the entity statement signature against the DID document', async () => {
    await seedIdentity(tmp)
    const status = await flywayStatus(tmp)
    expect(status.identity.signatureValid).toBe(true)
    expect(status.identity.issues).toEqual([])
  })
})

describe('flywayStatus — degraded states', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('flags a tampered entity statement as signature-invalid', async () => {
    await seedIdentity(tmp)
    const stmtPath = join(tmp, 'flyway', 'entity-statement.json')
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8'))
    stmt.sourceName = 'Imposter'
    writeFileSync(stmtPath, JSON.stringify(stmt, null, 2))
    const status = await flywayStatus(tmp)
    expect(status.identity.signatureValid).toBe(false)
    expect(status.identity.issues.some((i) => /does NOT verify/.test(i))).toBe(true)
  })

  it('flags a missing DID document when only the entity statement is present', async () => {
    await seedIdentity(tmp)
    rmSync(join(tmp, '.well-known', 'did.json'))
    const status = await flywayStatus(tmp)
    expect(status.identity.issues.some((i) => /\.well-known\/did\.json/.test(i))).toBe(true)
  })

  it('flags an unsigned (legacy) entity statement', async () => {
    await seedIdentity(tmp)
    const stmtPath = join(tmp, 'flyway', 'entity-statement.json')
    const stmt = JSON.parse(readFileSync(stmtPath, 'utf-8'))
    delete stmt.signature
    writeFileSync(stmtPath, JSON.stringify(stmt, null, 2))
    const status = await flywayStatus(tmp)
    expect(status.identity.signatureValid).toBe(false)
    expect(status.identity.issues.some((i) => /unsigned/.test(i))).toBe(true)
  })
})

describe('flywayStatus — peers and agreements', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reports peers.yaml when it exists', async () => {
    mkdirSync(join(tmp, 'flyway'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'peers.yaml'), 'peers: []\n')
    const status = await flywayStatus(tmp)
    expect(status.peers.present).toBe(true)
  })

  it('counts yaml files in flyway/agreements and lists their ids', async () => {
    mkdirSync(join(tmp, 'flyway', 'agreements'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'agreements', 'andamio-2026Q2.yaml'), 'kind: agreement\n')
    writeFileSync(join(tmp, 'flyway', 'agreements', 'odin-recognition.yaml'), 'kind: agreement\n')
    writeFileSync(join(tmp, 'flyway', 'agreements', 'README.md'), '# not an agreement')
    const status = await flywayStatus(tmp)
    expect(status.agreements.count).toBe(2)
    expect(status.agreements.ids).toEqual(['andamio-2026Q2', 'odin-recognition'])
  })

  it('ignores dotfiles in the agreements directory', async () => {
    mkdirSync(join(tmp, 'flyway', 'agreements'), { recursive: true })
    writeFileSync(join(tmp, 'flyway', 'agreements', '.gitkeep'), '')
    writeFileSync(join(tmp, 'flyway', 'agreements', 'real.yaml'), 'kind: agreement\n')
    const status = await flywayStatus(tmp)
    expect(status.agreements.count).toBe(1)
    expect(status.agreements.ids).toEqual(['real'])
  })
})

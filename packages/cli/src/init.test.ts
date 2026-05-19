import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'flyway-init-test-'))
}

const VALID_INPUT = {
  repoUrl: 'https://github.com/xeeban/flyway',
  sourceName: 'Nori',
  mode: 'interactive' as const,
}

describe('runInit', () => {
  let tmp: string
  beforeEach(() => {
    tmp = freshTmp()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes the three canonical identity files', () => {
    const result = runInit({ ...VALID_INPUT, cwd: tmp })
    expect(existsSync(join(tmp, '.well-known', 'did.json'))).toBe(true)
    expect(existsSync(join(tmp, 'flyway', 'entity-statement.json'))).toBe(true)
    expect(existsSync(join(tmp, 'flyway', 'keys', 'source.key'))).toBe(true)
    expect(result.filesWritten).toHaveLength(3)
  })

  it('the DID document is valid JSON with the expected DID id', () => {
    runInit({ ...VALID_INPUT, cwd: tmp })
    const didDoc = JSON.parse(readFileSync(join(tmp, '.well-known', 'did.json'), 'utf-8'))
    expect(didDoc.id).toBe('did:web:github.com:xeeban:flyway')
    expect(didDoc.verificationMethod).toHaveLength(1)
    expect(didDoc.verificationMethod[0].publicKeyJwk.crv).toBe('Ed25519')
  })

  it('the entity statement carries the Source name and mode', () => {
    runInit({ ...VALID_INPUT, cwd: tmp })
    const stmt = JSON.parse(
      readFileSync(join(tmp, 'flyway', 'entity-statement.json'), 'utf-8'),
    )
    expect(stmt.sourceName).toBe('Nori')
    expect(stmt.mode).toBe('interactive')
    expect(stmt.did).toBe('did:web:github.com:xeeban:flyway')
  })

  it('the private key file contains a PKCS#8 PEM block', () => {
    runInit({ ...VALID_INPUT, cwd: tmp })
    const key = readFileSync(join(tmp, 'flyway', 'keys', 'source.key'), 'utf-8')
    expect(key).toContain('BEGIN PRIVATE KEY')
    expect(key).toContain('END PRIVATE KEY')
  })

  it('creates .gitignore with flyway/keys/ when no .gitignore existed', () => {
    const result = runInit({ ...VALID_INPUT, cwd: tmp })
    expect(result.gitignoreUpdated).toBe(true)
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8')
    expect(gi).toContain('flyway/keys/')
  })

  it('appends flyway/keys/ to an existing .gitignore that lacks it', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules/\ndist/\n')
    const result = runInit({ ...VALID_INPUT, cwd: tmp })
    expect(result.gitignoreUpdated).toBe(true)
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8')
    expect(gi).toContain('node_modules/')
    expect(gi).toContain('flyway/keys/')
  })

  it('leaves an existing .gitignore alone if flyway/keys/ is already present', () => {
    writeFileSync(join(tmp, '.gitignore'), 'flyway/keys/\n')
    const result = runInit({ ...VALID_INPUT, cwd: tmp })
    expect(result.gitignoreUpdated).toBe(false)
  })

  it('refuses to overwrite an existing identity without --force', () => {
    runInit({ ...VALID_INPUT, cwd: tmp })
    expect(() => runInit({ ...VALID_INPUT, cwd: tmp })).toThrow(/already exists/)
  })

  it('overwrites when force is set', () => {
    runInit({ ...VALID_INPUT, cwd: tmp })
    const firstKey = readFileSync(join(tmp, 'flyway', 'keys', 'source.key'), 'utf-8')
    runInit({ ...VALID_INPUT, cwd: tmp, force: true })
    const secondKey = readFileSync(join(tmp, 'flyway', 'keys', 'source.key'), 'utf-8')
    expect(secondKey).not.toBe(firstKey)
  })
})

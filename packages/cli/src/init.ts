/**
 * CLI implementation of `flyway init`. Wraps the pure flywayInit() from
 * flyway-core with the filesystem placement decisions per the research
 * paper §6.7:
 *
 *   <cwd>/.well-known/did.json            — DID document
 *   <cwd>/flyway/entity-statement.json    — Source metadata
 *   <cwd>/flyway/keys/source.key          — ed25519 private key (PKCS#8 PEM)
 *   <cwd>/.gitignore                      — ensured to exclude flyway/keys/
 *
 * Re-running flyway init refuses to overwrite existing identity files
 * unless --force is set, to prevent accidental key loss.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { flywayInit, type FlywayMode } from '@murmurations-ai/flyway-core'

export interface RunInitOptions {
  readonly repoUrl: string
  readonly sourceName: string
  readonly mode: FlywayMode
  readonly cwd: string
  readonly force?: boolean
}

export interface RunInitResult {
  readonly did: string
  readonly filesWritten: readonly string[]
  readonly gitignoreUpdated: boolean
}

const GITIGNORE_LINE = 'flyway/keys/'

export async function runInit(options: RunInitOptions): Promise<RunInitResult> {
  const { cwd, force = false } = options

  const didDocPath = join(cwd, '.well-known', 'did.json')
  const entityStatementPath = join(cwd, 'flyway', 'entity-statement.json')
  const keyPath = join(cwd, 'flyway', 'keys', 'source.key')
  const gitignorePath = join(cwd, '.gitignore')

  if (!force) {
    const collisions = [didDocPath, entityStatementPath, keyPath].filter((p) => existsSync(p))
    if (collisions.length > 0) {
      throw new Error(
        `flyway identity already exists at: ${collisions.join(', ')}. ` +
          `Refusing to overwrite (rerun with --force to replace; losing the existing ` +
          `private key cannot be undone).`,
      )
    }
  }

  const artifacts = await flywayInit({
    repoUrl: options.repoUrl,
    sourceName: options.sourceName,
    mode: options.mode,
  })

  mkdirSync(join(cwd, '.well-known'), { recursive: true })
  mkdirSync(join(cwd, 'flyway', 'keys'), { recursive: true })

  writeFileSync(didDocPath, JSON.stringify(artifacts.didDocument, null, 2) + '\n')
  writeFileSync(
    entityStatementPath,
    JSON.stringify(artifacts.entityStatement, null, 2) + '\n',
  )
  writeFileSync(keyPath, artifacts.keypair.privateKeyPem, { mode: 0o600 })

  const gitignoreUpdated = ensureGitignore(gitignorePath)

  return {
    did: artifacts.did,
    filesWritten: [didDocPath, entityStatementPath, keyPath],
    gitignoreUpdated,
  }
}

function ensureGitignore(gitignorePath: string): boolean {
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${GITIGNORE_LINE}\n`)
    return true
  }
  const existing = readFileSync(gitignorePath, 'utf-8')
  const lines = existing.split('\n').map((l) => l.trim())
  if (lines.includes(GITIGNORE_LINE) || lines.includes(GITIGNORE_LINE.replace(/\/$/, ''))) {
    return false
  }
  const sep = existing.endsWith('\n') ? '' : '\n'
  writeFileSync(gitignorePath, `${existing}${sep}${GITIGNORE_LINE}\n`)
  return true
}

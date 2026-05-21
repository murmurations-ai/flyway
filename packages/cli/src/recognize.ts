/**
 * CLI wrapper for flyway_recognize. The pure logic lives in flyway-core;
 * this file owns the filesystem placement decisions:
 *
 *   flyway/peers.yaml                           — list of signed recognition entries
 *   flyway/peers/<host>/<owner>/<repo>/         — peer artifact cache
 *     did.json                                  — peer DID document at recognition time
 *     entity-statement.json                     — peer entity statement at recognition time
 *
 * For v0.1, peers are loaded from a local filesystem path. Remote (URL)
 * fetch is a separate milestone — same recognizePeer() core, different
 * fetch shim.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type SignedEntityStatement,
  type SignedRecognitionEntry,
  localEd25519Signer,
  peerCachePathSegments,
  recognizePeer,
} from '@murmurations-ai/flyway-core'
import { parseDocument, stringify as yamlStringify } from 'yaml'

export interface RunRecognizeOptions {
  /** Where this Source's identity lives (our cwd). */
  readonly cwd: string
  /** Absolute path to the peer's repo (must contain .well-known/did.json + flyway/entity-statement.json). */
  readonly peerRepoPath: string
  /** Optional human note. */
  readonly note?: string
  /** Replace an existing entry for the same DID. Defaults to false (error if already recognized). */
  readonly force?: boolean
}

export interface RunRecognizeResult {
  readonly peerDid: string
  readonly entry: SignedRecognitionEntry
  readonly filesWritten: readonly string[]
  readonly replacedPriorEntry: boolean
}

export async function runRecognize(options: RunRecognizeOptions): Promise<RunRecognizeResult> {
  const { cwd, peerRepoPath, force = false } = options

  // 1. Load OUR identity from cwd.
  const ourDidDocPath = join(cwd, '.well-known', 'did.json')
  const ourStmtPath = join(cwd, 'flyway', 'entity-statement.json')
  const ourKeyPath = join(cwd, 'flyway', 'keys', 'source.key')
  for (const [label, p] of [
    ['DID document', ourDidDocPath] as const,
    ['entity statement', ourStmtPath] as const,
    ['private key', ourKeyPath] as const,
  ]) {
    if (!existsSync(p)) {
      throw new Error(
        `flyway recognize: missing our ${label} at ${p}. Run \`flyway init\` first.`,
      )
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(
    readFileSync(ourStmtPath, 'utf-8'),
  ) as SignedEntityStatement
  const ourPrivateKeyPem = readFileSync(ourKeyPath, 'utf-8')

  // 2. Load the peer's identity from peerRepoPath.
  const peerDidDocPath = join(peerRepoPath, '.well-known', 'did.json')
  const peerStmtPath = join(peerRepoPath, 'flyway', 'entity-statement.json')
  for (const [label, p] of [
    ['DID document', peerDidDocPath] as const,
    ['entity statement', peerStmtPath] as const,
  ]) {
    if (!existsSync(p)) {
      throw new Error(
        `flyway recognize: peer ${label} missing at ${p}. Is ${peerRepoPath} a flyway-initialized repo?`,
      )
    }
  }
  const peerDidDocument = JSON.parse(readFileSync(peerDidDocPath, 'utf-8')) as DidDocument
  const peerEntityStatement = JSON.parse(
    readFileSync(peerStmtPath, 'utf-8'),
  ) as SignedEntityStatement

  // 3. Build the signer and call core recognizePeer.
  const verificationKeyId =
    ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ourDidDocument.verificationMethod[0]!.publicKeyJwk,
    verificationKeyId,
  })
  const recognizeInput = {
    peerDidDocument,
    peerEntityStatement,
    recognizedByDid: ourEntityStatement.did,
    signer,
    ...(options.note !== undefined ? { note: options.note } : {}),
  }
  const { entry } = await recognizePeer(recognizeInput)

  // 4. Read existing peers.yaml (if any), check for prior recognition.
  const peersPath = join(cwd, 'flyway', 'peers.yaml')
  const existing = readPeersFile(peersPath)
  const priorIdx = existing.peers.findIndex((p) => p.did === entry.did)
  const replacedPriorEntry = priorIdx >= 0
  if (replacedPriorEntry && !force) {
    throw new Error(
      `flyway recognize: peer ${entry.did} is already recognized in ${peersPath}. ` +
        `Re-run with --force to replace.`,
    )
  }
  if (replacedPriorEntry) {
    existing.peers.splice(priorIdx, 1)
  }
  existing.peers.push(entry)

  // 5. Write peers.yaml and peer cache.
  mkdirSync(join(cwd, 'flyway'), { recursive: true })
  writeFileSync(peersPath, serializePeersFile(existing))

  const cacheDir = join(cwd, 'flyway', 'peers', ...peerCachePathSegments(entry.did))
  mkdirSync(cacheDir, { recursive: true })
  const peerDidJsonPath = join(cacheDir, 'did.json')
  const peerStmtJsonPath = join(cacheDir, 'entity-statement.json')
  writeFileSync(peerDidJsonPath, JSON.stringify(peerDidDocument, null, 2) + '\n')
  writeFileSync(peerStmtJsonPath, JSON.stringify(peerEntityStatement, null, 2) + '\n')

  return {
    peerDid: entry.did,
    entry,
    filesWritten: [peersPath, peerDidJsonPath, peerStmtJsonPath],
    replacedPriorEntry,
  }
}

// ────────────────────────────────────────────────────────────────────────
// peers.yaml on-disk format. Schema is versioned so we can evolve.
// ────────────────────────────────────────────────────────────────────────

export const PEERS_SCHEMA = 'flyway-peers-v0'

export interface PeersFile {
  readonly schema: string
  peers: SignedRecognitionEntry[]
}

export function readPeersFile(path: string): PeersFile {
  if (!existsSync(path)) {
    return { schema: PEERS_SCHEMA, peers: [] }
  }
  const raw = readFileSync(path, 'utf-8')
  const doc = parseDocument(raw)
  const parsed = doc.toJS() as { schema?: string; peers?: SignedRecognitionEntry[] } | null
  if (!parsed || typeof parsed !== 'object') {
    return { schema: PEERS_SCHEMA, peers: [] }
  }
  return {
    schema: parsed.schema ?? PEERS_SCHEMA,
    peers: Array.isArray(parsed.peers) ? parsed.peers : [],
  }
}

export function serializePeersFile(file: PeersFile): string {
  const header =
    '# flyway peers — peers this murmuration recognizes.\n' +
    '# Each entry is signed by this Source. Schema: ' +
    PEERS_SCHEMA +
    '.\n' +
    '# Do not hand-edit signature fields; re-run `flyway recognize` instead.\n'
  return header + yamlStringify({ schema: file.schema, peers: file.peers })
}

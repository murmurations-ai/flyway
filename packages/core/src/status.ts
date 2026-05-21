/**
 * flyway_status — the first read-only tool. Inspects the local Source's
 * on-disk state and reports it back. Used by an agent to orient before
 * taking any flyway action ("am I initialized? are my peers recognized?
 * which agreements are in flight?").
 *
 * v0.1 scope:
 *   - identity   reads .well-known/did.json + flyway/entity-statement.json
 *                and verifies the entity statement signature
 *   - peers      reports presence of flyway/peers.yaml (no parsing yet)
 *   - agreements counts *.yaml files under flyway/agreements/
 *
 * Signals (inbox / outbox) are deliberately omitted from v0.1 — their
 * on-disk convention is not yet settled and we will add them when the
 * tools that produce them (flyway_propose / flyway_check) come online.
 *
 * This module reads files but does not write. It is therefore safe to
 * call from any context, including stateless adapters like the MCP
 * server.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import type { DidDocument, SignedEntityStatement } from './init.js'
import {
  type SignedRecognitionEntry,
  fingerprintEntityStatement,
  peerCachePathSegments,
  verifyRecognitionEntry,
} from './recognize.js'
import { DOMAIN_ENTITY_STATEMENT, verifyInlineSignedArtifact } from './signing.js'

export interface FlywayStatusIdentity {
  readonly initialized: boolean
  readonly did?: string
  readonly sourceName?: string
  readonly mode?: string
  /** True when the on-disk entity statement signature verifies against the on-disk DID document. */
  readonly signatureValid?: boolean
  /** Human-readable problems found during inspection. Empty when healthy. */
  readonly issues: readonly string[]
}

export interface FlywayStatusPeerEntry {
  readonly did: string
  readonly sourceName: string
  readonly recognizedAt: string
  /** True iff the recognition entry signature verifies against OUR DID document. */
  readonly recognitionValid: boolean
  /** True iff the cached peer artifacts still match the recognition entry's bindings (fingerprint + public key). False indicates drift. Undefined if the peer cache is missing. */
  readonly cacheConsistent?: boolean
  /** Per-peer issues — e.g. drift detected, cache missing, legacy entry without inline key. */
  readonly issues: readonly string[]
}

export interface FlywayStatusPeers {
  readonly file: string
  readonly present: boolean
  readonly count: number
  readonly entries: readonly FlywayStatusPeerEntry[]
}

export interface FlywayStatusAgreements {
  readonly directory: string
  readonly count: number
  /** Basenames without the .yaml extension. Sorted alphabetically. */
  readonly ids: readonly string[]
}

export interface FlywayStatus {
  readonly cwd: string
  readonly identity: FlywayStatusIdentity
  readonly peers: FlywayStatusPeers
  readonly agreements: FlywayStatusAgreements
}

const DID_DOC_PATH = ['.well-known', 'did.json'] as const
const ENTITY_STATEMENT_PATH = ['flyway', 'entity-statement.json'] as const
const PEERS_PATH = ['flyway', 'peers.yaml'] as const
const AGREEMENTS_DIR = ['flyway', 'agreements'] as const

export async function flywayStatus(cwd: string): Promise<FlywayStatus> {
  const identity = await inspectIdentity(cwd)
  const ourDidDocument = readOptionalJson<DidDocument>(join(cwd, ...DID_DOC_PATH))
  return {
    cwd,
    identity,
    peers: await inspectPeers(cwd, ourDidDocument),
    agreements: inspectAgreements(cwd),
  }
}

async function inspectIdentity(cwd: string): Promise<FlywayStatusIdentity> {
  const issues: string[] = []
  const didDocPath = join(cwd, ...DID_DOC_PATH)
  const stmtPath = join(cwd, ...ENTITY_STATEMENT_PATH)

  const didDocExists = existsSync(didDocPath)
  const stmtExists = existsSync(stmtPath)

  if (!didDocExists && !stmtExists) {
    return {
      initialized: false,
      issues: ['no flyway identity in this directory (run `flyway init` to create one)'],
    }
  }

  if (!didDocExists) issues.push(`missing ${didDocPath}`)
  if (!stmtExists) issues.push(`missing ${stmtPath}`)

  let didDocument: DidDocument | undefined
  let entityStatement: SignedEntityStatement | undefined

  if (didDocExists) {
    try {
      didDocument = JSON.parse(readFileSync(didDocPath, 'utf-8')) as DidDocument
    } catch (e) {
      issues.push(`could not parse ${didDocPath}: ${(e as Error).message}`)
    }
  }

  if (stmtExists) {
    try {
      entityStatement = JSON.parse(readFileSync(stmtPath, 'utf-8')) as SignedEntityStatement
    } catch (e) {
      issues.push(`could not parse ${stmtPath}: ${(e as Error).message}`)
    }
  }

  let signatureValid: boolean | undefined
  if (didDocument && entityStatement) {
    if (!entityStatement.signature) {
      issues.push('entity statement is unsigned — predates the signing milestone')
      signatureValid = false
    } else {
      try {
        signatureValid = await verifyInlineSignedArtifact(
          DOMAIN_ENTITY_STATEMENT,
          entityStatement,
          didDocument,
        )
        if (!signatureValid) {
          issues.push('entity statement signature does NOT verify against DID document')
        }
      } catch (e) {
        signatureValid = false
        issues.push(`signature verification failed: ${(e as Error).message}`)
      }
    }
  }

  if (didDocument && entityStatement && didDocument.id !== entityStatement.did) {
    issues.push(
      `DID mismatch: did.json declares ${didDocument.id} but entity-statement.json claims ${entityStatement.did}`,
    )
  }

  const did = entityStatement?.did ?? didDocument?.id
  const identity: FlywayStatusIdentity = {
    initialized: Boolean(didDocument && entityStatement),
    issues,
    ...(did !== undefined ? { did } : {}),
    ...(entityStatement?.sourceName !== undefined
      ? { sourceName: entityStatement.sourceName }
      : {}),
    ...(entityStatement?.mode !== undefined ? { mode: entityStatement.mode } : {}),
    ...(signatureValid !== undefined ? { signatureValid } : {}),
  }
  return identity
}

async function inspectPeers(
  cwd: string,
  ourDidDocument: DidDocument | undefined,
): Promise<FlywayStatusPeers> {
  const file = join('flyway', 'peers.yaml')
  const peersPath = join(cwd, ...PEERS_PATH)
  if (!existsSync(peersPath)) {
    return { file, present: false, count: 0, entries: [] }
  }

  let entries: SignedRecognitionEntry[]
  try {
    const raw = readFileSync(peersPath, 'utf-8')
    const parsed = parseDocument(raw).toJS() as { peers?: SignedRecognitionEntry[] } | null
    entries = parsed && Array.isArray(parsed.peers) ? parsed.peers : []
  } catch {
    return { file, present: true, count: 0, entries: [] }
  }

  const summarized: FlywayStatusPeerEntry[] = []
  for (const entry of entries) {
    let recognitionValid = false
    if (ourDidDocument) {
      try {
        recognitionValid = await verifyRecognitionEntry(entry, ourDidDocument)
      } catch {
        recognitionValid = false
      }
    }
    const drift = inspectPeerCacheDrift(cwd, entry)
    summarized.push({
      did: entry.did,
      sourceName: entry.sourceName,
      recognizedAt: entry.recognizedAt,
      recognitionValid,
      issues: drift.issues,
      ...(drift.cacheConsistent !== undefined
        ? { cacheConsistent: drift.cacheConsistent }
        : {}),
    })
  }

  return { file, present: true, count: summarized.length, entries: summarized }
}

function inspectPeerCacheDrift(
  cwd: string,
  entry: SignedRecognitionEntry,
): { cacheConsistent?: boolean; issues: string[] } {
  const issues: string[] = []
  let segments: readonly string[]
  try {
    segments = peerCachePathSegments(entry.did)
  } catch (e) {
    return { issues: [(e as Error).message] }
  }
  const peerDir = join(cwd, 'flyway', 'peers', ...segments)
  const peerDidPath = join(peerDir, 'did.json')
  const peerStmtPath = join(peerDir, 'entity-statement.json')
  if (!existsSync(peerDidPath) || !existsSync(peerStmtPath)) {
    issues.push(`peer cache missing under flyway/peers/${segments.join('/')}/`)
    return { issues }
  }

  let cachedDid: DidDocument
  let cachedStmt: SignedEntityStatement
  try {
    cachedDid = JSON.parse(readFileSync(peerDidPath, 'utf-8')) as DidDocument
    cachedStmt = JSON.parse(readFileSync(peerStmtPath, 'utf-8')) as SignedEntityStatement
  } catch (e) {
    issues.push(`could not parse peer cache: ${(e as Error).message}`)
    return { issues }
  }

  // Tolerate legacy entries that predate G1 (missing peerPublicKey / peerVerificationKeyId).
  const entryPubKey = (entry as { peerPublicKey?: { x?: string } }).peerPublicKey
  const entryKeyId = (entry as { peerVerificationKeyId?: string }).peerVerificationKeyId
  if (!entryPubKey || !entryKeyId) {
    issues.push(
      'legacy recognition entry (no inline peer public key) — rerun `flyway recognize --force` to refresh',
    )
  } else {
    const cachedMethod = cachedDid.verificationMethod.find((m) => m.id === entryKeyId)
    if (!cachedMethod) {
      issues.push(
        `peer DID document no longer carries verificationMethod ${entryKeyId} — peer may have rotated keys`,
      )
    } else if (cachedMethod.publicKeyJwk.x !== entryPubKey.x) {
      issues.push(
        `peer public key in cached DID document differs from recognition entry — peer rotated keys`,
      )
    }
  }

  const reFingerprint = fingerprintEntityStatement(cachedStmt)
  if (reFingerprint !== entry.entityStatementFingerprint) {
    issues.push(
      'cached peer entity statement no longer matches recognition fingerprint — peer reissued statement',
    )
  }

  return { cacheConsistent: issues.length === 0, issues }
}

function readOptionalJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return undefined
  }
}

function inspectAgreements(cwd: string): FlywayStatusAgreements {
  const directory = join('flyway', 'agreements')
  const dirPath = join(cwd, ...AGREEMENTS_DIR)
  if (!existsSync(dirPath)) {
    return { directory, count: 0, ids: [] }
  }
  let entries: string[]
  try {
    entries = readdirSync(dirPath)
  } catch {
    return { directory, count: 0, ids: [] }
  }
  const ids = entries
    .filter((name) => name.endsWith('.yaml') && !name.startsWith('.'))
    .map((name) => name.slice(0, -'.yaml'.length))
    .sort()
  return { directory, count: ids.length, ids }
}

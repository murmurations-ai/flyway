/**
 * flyway_status — the first read-only tool. Inspects the local Source's
 * on-disk state and reports it back. Used by an agent to orient before
 * taking any flyway action ("am I initialized? are my peers recognized?
 * which agreements are in flight?").
 *
 * Scope:
 *   - identity    reads .well-known/did.json + flyway/entity-statement.json
 *                 and verifies the entity statement signature
 *   - peers       parses flyway/peers.yaml, verifies each recognition entry,
 *                 flags cache drift, and marks a relationship closed when a
 *                 peer exit targets it (ADR-0013)
 *   - agreements  parses each flyway/agreements/*.yaml and reports its
 *                 effective lifecycle state — closed if the file says so or
 *                 a verified exit supersedes it (ADR-0013)
 *   - exits       counts honored exits and surfaces refused inbox exits
 *
 * Effective closed-state is a *read*: exit records inform the view, but the
 * co-signed agreement file is never mutated (ADR-0008 immutability). An
 * inbox exit is honored only if it passes the flyway_check trust gate
 * (recognized peer, verified signature, sentAt >= recognizedAt).
 *
 * This module reads files but does not write. It is therefore safe to
 * call from any context, including stateless adapters like the MCP
 * server.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import type { FlywayAgreement, FlywayAgreementState } from './agreements.js'
import {
  EXIT_TARGET_TYPES,
  type ExitBody,
  type ExitTargetType,
} from './exit.js'
import type { DidDocument, SignedEntityStatement } from './init.js'
import {
  type SignedRecognitionEntry,
  fingerprintEntityStatement,
  peerCachePathSegments,
  verifyRecognitionEntry,
} from './recognize.js'
import {
  type SignedSignalEnvelope,
  collectYamlFiles,
  readSignalFile,
  verifySignedSignal,
} from './signal.js'
import { DOMAIN_ENTITY_STATEMENT, verifyInlineSignedArtifact } from './signing.js'

/** From the reading Source's vantage: did we send the exit, or did the peer? */
export type FlywayExitDirection = 'we-exited' | 'peer-exited'

/**
 * A normalized, *honored* exit — an outbox exit we authored, or an inbox
 * exit that passed the flyway_check trust gate (recognized peer, verified
 * signature, sentAt >= recognizedAt). Unverified inbox exits never become
 * one of these; they are reported as issues instead.
 */
interface EffectiveExit {
  readonly direction: FlywayExitDirection
  readonly targetType: ExitTargetType
  /** peer exit: the peer DID; project/syndicate exit: the membership id. */
  readonly target: string
  /** The other party's DID (outbox: recipient; inbox: sender). */
  readonly peer: string
  /** Exit notice sentAt. */
  readonly at: string
  readonly exitId: string
  readonly reason?: string
}

/** How a peer relationship or agreement was closed by an exit. */
export interface FlywayStatusClosure {
  readonly direction: FlywayExitDirection
  /** Which kind of exit closed it. */
  readonly via: ExitTargetType
  /** The exit target (peer DID or membership id). */
  readonly target: string
  /** Exit notice sentAt. */
  readonly at: string
  readonly exitId: string
  readonly reason?: string
}

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
  /**
   * Present when a `peer` exit has closed this relationship (ADR-0013).
   * Recognition is NOT retracted by exit — a closed relationship with a
   * still-valid recognition entry is normal. Absent when the relationship
   * is live.
   */
  readonly closure?: FlywayStatusClosure
  /** Per-peer issues — e.g. drift detected, cache missing, legacy entry without inline key. */
  readonly issues: readonly string[]
}

export interface FlywayStatusPeers {
  readonly file: string
  readonly present: boolean
  readonly count: number
  readonly entries: readonly FlywayStatusPeerEntry[]
}

export interface FlywayStatusAgreementEntry {
  readonly id: string
  /** Lifecycle state as written in the co-signed file. Undefined if the file could not be parsed. */
  readonly fileState?: FlywayAgreementState
  /**
   * Effective lifecycle state after applying exit records (ADR-0013):
   * `closed` if the file says so, or a verified exit supersedes it;
   * otherwise equal to fileState. The file itself is never mutated.
   */
  readonly effectiveState?: FlywayAgreementState
  /** Present when an exit (not the file) is what closed this agreement. */
  readonly closure?: FlywayStatusClosure
  /** Participant DIDs read from the file. Empty if unparseable. */
  readonly participants: readonly string[]
  /** Per-agreement issues — parse failures, etc. */
  readonly issues: readonly string[]
}

export interface FlywayStatusAgreements {
  readonly directory: string
  readonly count: number
  /** Basenames without the .yaml extension. Sorted alphabetically. */
  readonly ids: readonly string[]
  /** Per-agreement detail with exit-aware effective state (ADR-0013). Ordered by id. */
  readonly entries: readonly FlywayStatusAgreementEntry[]
  /** How many agreements are effectively closed (by file state or exit). */
  readonly closedCount: number
}

/** Summary of exit signals informing effective state (ADR-0013). */
export interface FlywayStatusExits {
  /** Honored exits — outbox exits we authored + verified inbox exits. */
  readonly count: number
  /**
   * Inbox exits that were refused (unrecognized sender, bad signature,
   * retroactive sentAt, or malformed body) and therefore closed nothing.
   */
  readonly issues: readonly string[]
}

export interface FlywayStatus {
  readonly cwd: string
  readonly identity: FlywayStatusIdentity
  readonly peers: FlywayStatusPeers
  readonly agreements: FlywayStatusAgreements
  readonly exits: FlywayStatusExits
}

const DID_DOC_PATH = ['.well-known', 'did.json'] as const
const ENTITY_STATEMENT_PATH = ['flyway', 'entity-statement.json'] as const
const PEERS_PATH = ['flyway', 'peers.yaml'] as const
const AGREEMENTS_DIR = ['flyway', 'agreements'] as const

export async function flywayStatus(cwd: string): Promise<FlywayStatus> {
  const identity = await inspectIdentity(cwd)
  const ourDidDocument = readOptionalJson<DidDocument>(join(cwd, ...DID_DOC_PATH))
  const recognizedPeers = readRecognizedPeerMap(cwd)
  const { exits, issues: exitIssues } = await collectEffectiveExits(cwd, recognizedPeers)
  return {
    cwd,
    identity,
    peers: await inspectPeers(cwd, ourDidDocument, exits),
    agreements: inspectAgreements(cwd, exits),
    exits: { count: exits.length, issues: exitIssues },
  }
}

// ────────────────────────────────────────────────────────────────────────
// Exit records → effective state (ADR-0013)
// ────────────────────────────────────────────────────────────────────────

const OUTBOX_ROOT = ['flyway', 'outbox'] as const
const INBOX_ROOT = ['flyway', 'inbox'] as const

/**
 * Gather every *honored* exit informing effective state: outbox exits we
 * authored (trusted as our own signed records) plus inbox exits that pass
 * the flyway_check trust gate. Refused inbox exits are collected as issues
 * and close nothing.
 */
async function collectEffectiveExits(
  cwd: string,
  recognizedPeers: Map<string, SignedRecognitionEntry>,
): Promise<{ exits: EffectiveExit[]; issues: string[] }> {
  const exits: EffectiveExit[] = []
  const issues: string[] = []

  for (const path of collectYamlFiles(join(cwd, ...OUTBOX_ROOT))) {
    const env = readSignalFile(path)
    if (!env || env.kind !== 'exit') continue
    const norm = normalizeExit(env, 'we-exited', env.to, issues)
    if (norm) exits.push(norm)
  }

  for (const path of collectYamlFiles(join(cwd, ...INBOX_ROOT))) {
    const env = readSignalFile(path)
    if (!env || env.kind !== 'exit') continue
    if (!(await honorInboxExit(cwd, env, recognizedPeers, issues))) continue
    const norm = normalizeExit(env, 'peer-exited', env.from, issues)
    if (norm) exits.push(norm)
  }

  return { exits, issues }
}

/** Validate and normalize an exit envelope body into an EffectiveExit. */
function normalizeExit(
  env: SignedSignalEnvelope,
  direction: FlywayExitDirection,
  peer: string,
  issues: string[],
): EffectiveExit | null {
  const body = env.body as Partial<ExitBody> | undefined
  if (
    !body ||
    typeof body !== 'object' ||
    !EXIT_TARGET_TYPES.includes(body.targetType as ExitTargetType) ||
    typeof body.target !== 'string' ||
    body.target.trim() === ''
  ) {
    issues.push(`exit ${env.id} has a malformed body — ignored`)
    return null
  }
  return {
    direction,
    targetType: body.targetType as ExitTargetType,
    target: body.target,
    peer,
    at: env.sentAt,
    exitId: env.id,
    ...(typeof body.reason === 'string' && body.reason.trim() !== ''
      ? { reason: body.reason }
      : {}),
  }
}

/**
 * The same gate flyway_check applies before trusting an inbox signal:
 * recognized sender, signature verifies against the recognition-time
 * cached DID document, and sentAt is not before recognizedAt. A dropped-in
 * or forged exit cannot close a live relationship.
 */
async function honorInboxExit(
  cwd: string,
  env: SignedSignalEnvelope,
  recognizedPeers: Map<string, SignedRecognitionEntry>,
  issues: string[],
): Promise<boolean> {
  const peerEntry = recognizedPeers.get(env.from)
  if (!peerEntry) {
    issues.push(`inbox exit ${env.id} from unrecognized ${env.from} — not honored`)
    return false
  }
  if (peerEntry.recognizedAt && env.sentAt < peerEntry.recognizedAt) {
    issues.push(
      `inbox exit ${env.id} sentAt (${env.sentAt}) predates recognizedAt ` +
        `(${peerEntry.recognizedAt}) — not honored`,
    )
    return false
  }
  try {
    const segments = peerCachePathSegments(env.from)
    const didDocPath = join(cwd, 'flyway', 'peers', ...segments, 'did.json')
    if (!existsSync(didDocPath)) {
      issues.push(`inbox exit ${env.id}: peer DID document missing — not honored`)
      return false
    }
    const peerDid = JSON.parse(readFileSync(didDocPath, 'utf-8')) as DidDocument
    if (!(await verifySignedSignal(env, peerDid))) {
      issues.push(`inbox exit ${env.id}: signature does not verify — not honored`)
      return false
    }
  } catch (e) {
    issues.push(`inbox exit ${env.id}: verification failed: ${(e as Error).message} — not honored`)
    return false
  }
  return true
}

function readRecognizedPeerMap(cwd: string): Map<string, SignedRecognitionEntry> {
  const peersPath = join(cwd, ...PEERS_PATH)
  if (!existsSync(peersPath)) return new Map()
  try {
    const raw = readFileSync(peersPath, 'utf-8')
    const parsed = parseDocument(raw).toJS() as { peers?: SignedRecognitionEntry[] } | null
    const entries = parsed && Array.isArray(parsed.peers) ? parsed.peers : []
    return new Map(entries.map((e) => [e.did, e]))
  } catch {
    return new Map()
  }
}

/** The earliest peer-exit that closed this relationship, if any. */
function closureForPeer(
  did: string,
  exits: readonly EffectiveExit[],
): FlywayStatusClosure | undefined {
  const relevant = exits.filter((e) => e.targetType === 'peer' && e.peer === did)
  return earliestClosure(relevant)
}

/**
 * The earliest exit that closed this agreement: a peer-exit for any
 * participant, or a project/syndicate exit whose target matches the
 * agreement's membership and whose other party is a participant.
 */
function closureForAgreement(
  agreement: Pick<FlywayAgreement, 'projectId' | 'syndicateId'>,
  participants: readonly string[],
  exits: readonly EffectiveExit[],
): FlywayStatusClosure | undefined {
  const pset = new Set(participants)
  const relevant = exits.filter((e) => {
    if (!pset.has(e.peer)) return false
    switch (e.targetType) {
      case 'peer':
        return true
      case 'project':
        return e.target === agreement.projectId
      case 'syndicate':
        return e.target === agreement.syndicateId
    }
  })
  return earliestClosure(relevant)
}

function earliestClosure(relevant: readonly EffectiveExit[]): FlywayStatusClosure | undefined {
  if (relevant.length === 0) return undefined
  const first = relevant.reduce((a, b) => (b.at < a.at ? b : a))
  return {
    direction: first.direction,
    via: first.targetType,
    target: first.target,
    at: first.at,
    exitId: first.exitId,
    ...(first.reason !== undefined ? { reason: first.reason } : {}),
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
  exits: readonly EffectiveExit[],
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
    const closure = closureForPeer(entry.did, exits)
    summarized.push({
      did: entry.did,
      sourceName: entry.sourceName,
      recognizedAt: entry.recognizedAt,
      recognitionValid,
      issues: drift.issues,
      ...(drift.cacheConsistent !== undefined
        ? { cacheConsistent: drift.cacheConsistent }
        : {}),
      ...(closure !== undefined ? { closure } : {}),
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

function inspectAgreements(
  cwd: string,
  exits: readonly EffectiveExit[],
): FlywayStatusAgreements {
  const directory = join('flyway', 'agreements')
  const dirPath = join(cwd, ...AGREEMENTS_DIR)
  const empty: FlywayStatusAgreements = {
    directory,
    count: 0,
    ids: [],
    entries: [],
    closedCount: 0,
  }
  if (!existsSync(dirPath)) return empty
  let names: string[]
  try {
    names = readdirSync(dirPath)
  } catch {
    return empty
  }
  const ids = names
    .filter((name) => name.endsWith('.yaml') && !name.startsWith('.'))
    .map((name) => name.slice(0, -'.yaml'.length))
    .sort()

  const entries: FlywayStatusAgreementEntry[] = []
  let closedCount = 0
  for (const id of ids) {
    const entry = inspectAgreementFile(cwd, id, exits)
    entries.push(entry)
    if (entry.effectiveState === 'closed') closedCount++
  }
  return { directory, count: ids.length, ids, entries, closedCount }
}

function inspectAgreementFile(
  cwd: string,
  id: string,
  exits: readonly EffectiveExit[],
): FlywayStatusAgreementEntry {
  const issues: string[] = []
  const path = join(cwd, ...AGREEMENTS_DIR, `${id}.yaml`)
  // Parsed from untrusted YAML — required fields may be absent, so type it
  // partial rather than asserting a well-formed FlywayAgreement.
  let agreement: Partial<FlywayAgreement> | undefined
  try {
    agreement = parseDocument(readFileSync(path, 'utf-8')).toJS() as Partial<FlywayAgreement>
  } catch (e) {
    issues.push(`could not parse agreement: ${(e as Error).message}`)
  }
  if (!agreement || typeof agreement !== 'object') {
    return {
      id,
      participants: [],
      issues: issues.length > 0 ? issues : ['agreement file is empty or malformed'],
    }
  }

  const participants = Array.isArray(agreement.participants) ? agreement.participants : []
  const fileState = agreement.state
  const closure = closureForAgreement(agreement, participants, exits)
  const effectiveState: FlywayAgreementState | undefined =
    fileState === 'closed' ? 'closed' : closure !== undefined ? 'closed' : fileState

  return {
    id,
    participants,
    issues,
    ...(fileState !== undefined ? { fileState } : {}),
    ...(effectiveState !== undefined ? { effectiveState } : {}),
    ...(closure !== undefined ? { closure } : {}),
  }
}

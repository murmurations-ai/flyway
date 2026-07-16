/**
 * flyway_check — read all signals delivered to this Source's inbox and
 * report their status. Per ADR-0008, transport-agnostic: anything sitting
 * at flyway/inbox/<host>/<owner>/<repo>/<id>.yaml is a signal.
 *
 * Verification flow per signal:
 *   1. Parse + narrow to SignedSignalEnvelope; malformed → issue.
 *   2. Look up sender in flyway/peers.yaml. Absent → flag unrecognized;
 *      do not attempt signature verification (we have no key).
 *   3. Load cached peer DID document from
 *      flyway/peers/<peer-segments>/did.json. Missing → issue.
 *   4. Derive domain from envelope.kind; verifyInlineSignedArtifact.
 *
 * This module reads but does not write — flyway_check is non-destructive.
 * Lifecycle management (archive, mark-read) lives in later tools.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { parseDocument } from 'yaml'
import type { DidDocument } from './init.js'
import { type SignedRecognitionEntry, peerCachePathSegments } from './recognize.js'
import {
  type SignalKind,
  type SignedSignalEnvelope,
  collectYamlFiles,
  domainForSignalKind,
  readSignalFile,
  signalOutboxPath,
  verifySignedSignal,
} from './signal.js'

export interface FlywaySignalInboxEntry {
  readonly envelope: SignedSignalEnvelope
  readonly path: string
  /** Path component (sender DID inferred from disk layout) matches envelope.from. False ⇒ misplaced file. */
  readonly fromPathMatchesEnvelope: boolean
  /** True iff envelope.from is in our flyway/peers.yaml. */
  readonly fromRecognized: boolean
  /** True iff the signature verifies. Undefined when fromRecognized is false (no key available). */
  readonly signatureValid?: boolean
  readonly kind: SignalKind
  readonly issues: readonly string[]
}

export interface FlywaySignalInbox {
  readonly cwd: string
  readonly signals: readonly FlywaySignalInboxEntry[]
  readonly totalCount: number
  /** Signals that are recognized AND verified. */
  readonly validCount: number
  /** Per-inbox issues (parse failures, malformed envelopes). */
  readonly issues: readonly string[]
}

const INBOX_ROOT = ['flyway', 'inbox'] as const
const PEERS_PATH = ['flyway', 'peers.yaml'] as const

export async function flywayCheck(cwd: string): Promise<FlywaySignalInbox> {
  const inboxRoot = join(cwd, ...INBOX_ROOT)
  const issues: string[] = []

  const recognizedPeers = readRecognizedPeers(cwd)

  if (!existsSync(inboxRoot)) {
    return { cwd, signals: [], totalCount: 0, validCount: 0, issues }
  }

  const files = collectYamlFiles(inboxRoot)
  const signals: FlywaySignalInboxEntry[] = []
  let validCount = 0

  for (const path of files) {
    const entry = await inspectSignalFile(cwd, path, inboxRoot, recognizedPeers, issues)
    if (entry) {
      signals.push(entry)
      if (entry.fromRecognized && entry.signatureValid && entry.issues.length === 0) {
        validCount++
      }
    }
  }

  return { cwd, signals, totalCount: signals.length, validCount, issues }
}

async function inspectSignalFile(
  cwd: string,
  path: string,
  inboxRoot: string,
  recognizedPeers: Map<string, SignedRecognitionEntry>,
  globalIssues: string[],
): Promise<FlywaySignalInboxEntry | null> {
  const envelope = readSignalFile(path)
  if (!envelope) {
    globalIssues.push(`could not parse signal at ${path} (not flyway-signal-v0 or unreadable)`)
    return null
  }
  const perEntryIssues: string[] = []

  // Confirm the on-disk path matches the envelope.from (the file must
  // live under flyway/inbox/<peer-segments>/<id>.yaml).
  let fromPathMatchesEnvelope = false
  try {
    const expectedDir = join(inboxRoot, ...peerCachePathSegments(envelope.from))
    fromPathMatchesEnvelope = path.startsWith(expectedDir + sep)
  } catch {
    perEntryIssues.push(`envelope.from DID is not a did:web (got: ${envelope.from})`)
  }
  if (!fromPathMatchesEnvelope && perEntryIssues.length === 0) {
    perEntryIssues.push(`signal file is not in the expected inbox subpath for envelope.from`)
  }

  // Did the envelope sign over the right domain for its declared kind?
  if (envelope.signature.domain !== domainForSignalKind(envelope.kind)) {
    perEntryIssues.push(
      `signature domain ${envelope.signature.domain} does not match envelope.kind ${envelope.kind}`,
    )
  }

  // Is the sender currently recognized?
  const peerEntry = recognizedPeers.get(envelope.from)
  const fromRecognized = peerEntry !== undefined
  if (!fromRecognized) {
    perEntryIssues.push(
      `sender ${envelope.from} is not in flyway/peers.yaml — refusing to verify signature`,
    )
    return {
      envelope,
      path,
      fromPathMatchesEnvelope,
      fromRecognized: false,
      kind: envelope.kind,
      issues: perEntryIssues,
    }
  }

  // Reject signals dated before recognition: a peer cannot retroactively
  // gain recognition over older signed material. This also flags
  // "ghost" signals dropped into the inbox before the sender was a
  // peer.
  if (peerEntry.recognizedAt && envelope.sentAt < peerEntry.recognizedAt) {
    perEntryIssues.push(
      `signal sentAt (${envelope.sentAt}) predates peer recognizedAt ` +
        `(${peerEntry.recognizedAt}) — refusing retroactive validation`,
    )
  }

  // Load cached peer DID document and verify.
  let signatureValid = false
  try {
    const segments = peerCachePathSegments(envelope.from)
    const didDocPath = join(cwd, 'flyway', 'peers', ...segments, 'did.json')
    if (!existsSync(didDocPath)) {
      perEntryIssues.push(
        `peer DID document missing at flyway/peers/${segments.join('/')}/did.json`,
      )
    } else {
      const peerDidDocument = JSON.parse(readFileSync(didDocPath, 'utf-8')) as DidDocument
      signatureValid = await verifySignedSignal(envelope, peerDidDocument)
      if (!signatureValid) {
        perEntryIssues.push('signature does NOT verify against cached peer DID document')
      }
    }
  } catch (e) {
    perEntryIssues.push(`signature verification failed: ${(e as Error).message}`)
  }

  // Cross-reference refs against our outbox (Issue #14 / G7). A response
  // signal claims to point at a prior signal we sent; if that signal
  // isn't actually in our outbox — or doesn't have the right shape —
  // the response is structurally suspect even when its own signature
  // verifies. Caught here rather than at the responder so we surface
  // forged references in our own audit log.
  verifyRefsResolve(cwd, envelope, perEntryIssues)

  return {
    envelope,
    path,
    fromPathMatchesEnvelope,
    fromRecognized: true,
    signatureValid,
    kind: envelope.kind,
    issues: perEntryIssues,
  }
}

/**
 * For respond signals, verify the referenced prior artifact resolves to
 * a real signal in our outbox with the expected shape. A response must
 * point at either a prior tension (refs.tensionId) or a prior proposal
 * (refs.proposalId); the resolved subject must live in our outbox
 * (we sent it), have the right kind, and have been addressed to the
 * responder.
 */
function verifyRefsResolve(
  cwd: string,
  envelope: SignedSignalEnvelope,
  perEntryIssues: string[],
): void {
  if (envelope.kind !== 'respond') return
  const tensionId = envelope.refs?.tensionId
  const proposalId = envelope.refs?.proposalId
  if (!tensionId && !proposalId) {
    perEntryIssues.push(
      'respond signal missing both refs.tensionId and refs.proposalId — ' +
        'every response must point at a subject',
    )
    return
  }
  if (tensionId) {
    verifyOneRef(cwd, envelope, 'tensionId', 'tension', tensionId, perEntryIssues)
  }
  if (proposalId) {
    verifyOneRef(cwd, envelope, 'proposalId', 'proposal', proposalId, perEntryIssues)
  }
}

function verifyOneRef(
  cwd: string,
  envelope: SignedSignalEnvelope,
  refKey: 'tensionId' | 'proposalId',
  expectedKind: 'tension' | 'proposal',
  refId: string,
  perEntryIssues: string[],
): void {
  let outboxPath: string
  try {
    outboxPath = signalOutboxPath(cwd, envelope.from, refId)
  } catch (e) {
    perEntryIssues.push(`refs.${refKey} verification failed: ${(e as Error).message}`)
    return
  }
  const subject = readSignalFile(outboxPath)
  if (!subject) {
    perEntryIssues.push(
      `refs.${refKey}='${refId}' has no matching signal in our outbox at ` +
        `flyway/outbox/<responder-segments>/${refId}.yaml — ` +
        'response points at a subject we never sent',
    )
    return
  }
  if (subject.id !== refId) {
    perEntryIssues.push(
      `refs.${refKey}='${refId}' resolves to a file whose envelope.id is ` +
        `'${subject.id}' (file/envelope id mismatch — possible tampering)`,
    )
  }
  if (subject.kind !== expectedKind) {
    perEntryIssues.push(
      `refs.${refKey}='${refId}' resolves to a ${subject.kind} signal, ` + `not a ${expectedKind}`,
    )
  }
  if (subject.to !== envelope.from) {
    perEntryIssues.push(
      `refs.${refKey}='${refId}' resolves to a ${expectedKind} we sent to ` +
        `${subject.to}, not to ${envelope.from} (the responder)`,
    )
  }
  // Intra-thread ordering (Issue #16 / G9): a response can't predate the
  // subject it answers. Clocks drift by seconds, not backwards across the
  // exchange — a response dated before its subject is suspicious for audit.
  // Sibling to the SEC-3 sentAt >= recognizedAt check, one level finer.
  if (
    typeof subject.sentAt === 'string' &&
    typeof envelope.sentAt === 'string' &&
    envelope.sentAt < subject.sentAt
  ) {
    perEntryIssues.push(
      `response sentAt (${envelope.sentAt}) precedes the ${expectedKind} it answers ` +
        `(refs.${refKey}='${refId}' sentAt ${subject.sentAt}) — response predates its subject`,
    )
  }
}

/**
 * Read flyway/peers.yaml into a DID→entry map — the single source of truth
 * for "who do we recognize?" shared by flyway_check and flyway_status
 * (Issue #28; formerly duplicated verbatim as status.ts's
 * `readRecognizedPeerMap`). Returns a Map (the old `…Set` name was a
 * misnomer). Never throws: a missing or unparseable file yields an empty map.
 */
export function readRecognizedPeers(cwd: string): Map<string, SignedRecognitionEntry> {
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

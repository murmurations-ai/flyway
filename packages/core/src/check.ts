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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { parseDocument } from 'yaml'
import type { DidDocument } from './init.js'
import {
  type SignedRecognitionEntry,
  peerCachePathSegments,
} from './recognize.js'
import {
  SIGNAL_SCHEMA_VERSION,
  type SignalKind,
  type SignedSignalEnvelope,
  domainForSignalKind,
  readSignalFile,
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

  const recognizedPeers = readRecognizedPeerSet(cwd)

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
      if (entry.fromRecognized && entry.signatureValid) validCount++
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
  if (envelope.schema !== SIGNAL_SCHEMA_VERSION) {
    globalIssues.push(`${path}: unsupported signal schema ${(envelope as { schema?: string }).schema}`)
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
    perEntryIssues.push(
      `signal file is not in the expected inbox subpath for envelope.from`,
    )
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

  // Load cached peer DID document and verify.
  let signatureValid = false
  try {
    const segments = peerCachePathSegments(envelope.from)
    const didDocPath = join(cwd, 'flyway', 'peers', ...segments, 'did.json')
    if (!existsSync(didDocPath)) {
      perEntryIssues.push(`peer DID document missing at flyway/peers/${segments.join('/')}/did.json`)
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

function readRecognizedPeerSet(cwd: string): Map<string, SignedRecognitionEntry> {
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

function collectYamlFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(full)
      } else if (stat.isFile() && name.endsWith('.yaml')) {
        out.push(full)
      }
    }
  }
  return out.sort()
}

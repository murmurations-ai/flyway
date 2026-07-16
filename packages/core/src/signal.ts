/**
 * Signal envelopes — the on-disk artifact carrying a single
 * cross-murmuration message (tension, proposal, response, exit).
 *
 * Per ADR-0008:
 *   - One signed envelope per signal.
 *   - Kind-specific domain tag (DOMAIN_TENSION / _PROPOSAL / _RESPOND /
 *     _EXIT) prevents cross-kind replay.
 *   - One file per signal at:
 *       flyway/inbox/<host>/<owner>/<repo>/<id>.yaml   (receiver)
 *       flyway/outbox/<host>/<owner>/<repo>/<id>.yaml  (sender)
 *   - Transport is pluggable; v0.1 ships a local-filesystem default.
 *
 * This module does not perform delivery — only canonical envelope
 * production / verification and the I/O for placing an envelope in
 * inbox or outbox.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, stringify as yamlStringify } from 'yaml'
import type { DidDocument } from './init.js'
import { peerCachePathSegments } from './recognize.js'
import {
  DOMAIN_EXIT,
  DOMAIN_PROPOSAL,
  DOMAIN_RESPOND,
  DOMAIN_TENSION,
  type SignatureEnvelope,
  type Signer,
  signArtifactInline,
  verifyInlineSignedArtifact,
} from './signing.js'

export type SignalKind = 'tension' | 'proposal' | 'respond' | 'exit'

export const SIGNAL_KINDS: readonly SignalKind[] = ['tension', 'proposal', 'respond', 'exit']

export const SIGNAL_SCHEMA_VERSION = 'flyway-signal-v0' as const

export interface SignalEnvelope {
  readonly schema: typeof SIGNAL_SCHEMA_VERSION
  readonly id: string
  readonly from: string
  readonly to: string
  readonly sentAt: string
  readonly kind: SignalKind
  readonly body: unknown
  readonly refs?: SignalRefs
}

export interface SignalRefs {
  readonly inReplyTo?: string
  readonly tensionId?: string
  readonly proposalId?: string
}

export type SignedSignalEnvelope = SignalEnvelope & {
  readonly signature: SignatureEnvelope
}

/**
 * Derive the domain tag for a given signal kind. Domains are
 * intentionally distinct so a signature over one kind cannot be replayed
 * as another.
 */
export function domainForSignalKind(kind: SignalKind): string {
  switch (kind) {
    case 'tension':
      return DOMAIN_TENSION
    case 'proposal':
      return DOMAIN_PROPOSAL
    case 'respond':
      return DOMAIN_RESPOND
    case 'exit':
      return DOMAIN_EXIT
  }
}

/**
 * Build and sign a signal envelope. `from` must match
 * `signer.verificationKeyId` modulo the fragment; we do not check that
 * here — the caller is the only party that knows the relationship.
 */
export interface BuildSignedSignalInput {
  readonly from: string
  readonly to: string
  readonly kind: SignalKind
  readonly body: unknown
  readonly signer: Signer
  readonly refs?: SignalRefs
  /** Override id generation. */
  readonly id?: string
  /** Override "now" for testing/determinism. */
  readonly now?: Date
}

export async function buildSignedSignal(
  input: BuildSignedSignalInput,
): Promise<SignedSignalEnvelope> {
  const now = input.now ?? new Date()
  const id = input.id ?? generateSignalId(now)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error(`buildSignedSignal: id must match [A-Za-z0-9_-]{1,128} (got: ${id})`)
  }
  const envelope: SignalEnvelope = {
    schema: SIGNAL_SCHEMA_VERSION,
    id,
    from: input.from,
    to: input.to,
    sentAt: now.toISOString(),
    kind: input.kind,
    body: input.body,
    ...(input.refs !== undefined ? { refs: input.refs } : {}),
  }
  const signed = await signArtifactInline(domainForSignalKind(input.kind), envelope, input.signer)
  return signed
}

/**
 * Verify a signed envelope against the *sender*'s DID document. The kind
 * is read from the (signed) envelope and the corresponding domain is
 * applied — so an attacker who tries to rewrite `kind` without re-signing
 * cannot pass verify.
 */
export async function verifySignedSignal(
  envelope: SignedSignalEnvelope,
  senderDidDocument: DidDocument,
): Promise<boolean> {
  if (envelope.signature.domain !== domainForSignalKind(envelope.kind)) {
    return false
  }
  return verifyInlineSignedArtifact(domainForSignalKind(envelope.kind), envelope, senderDidDocument)
}

/**
 * Generate a sender-unique, time-sortable signal id.
 *   <ms-zero-padded-13>-<8-hex>
 * The leading milliseconds component makes ids sort by send time within
 * a single sender's stream.
 */
export function generateSignalId(now: Date = new Date()): string {
  const ms = now.getTime().toString().padStart(13, '0')
  const tail = randomBytes(4).toString('hex')
  return `${ms}-${tail}`
}

// ────────────────────────────────────────────────────────────────────────
// On-disk placement.
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute the path at which a signal sits in a repo's inbox / outbox.
 * The peer segments come from the *other party's* DID — i.e. for an
 * inbox file, the peer is the sender; for outbox, the recipient.
 */
export function signalInboxPath(repoCwd: string, fromDid: string, id: string): string {
  return join(repoCwd, 'flyway', 'inbox', ...peerCachePathSegments(fromDid), `${id}.yaml`)
}

export function signalOutboxPath(repoCwd: string, toDid: string, id: string): string {
  return join(repoCwd, 'flyway', 'outbox', ...peerCachePathSegments(toDid), `${id}.yaml`)
}

const INBOX_HEADER =
  '# flyway inbox signal — delivered by a peer murmuration. Schema: flyway-signal-v0.\n' +
  '# Do not hand-edit; this file is a signed envelope.\n'

const OUTBOX_HEADER =
  '# flyway outbox signal — sent to a peer. Schema: flyway-signal-v0.\n' +
  '# Do not hand-edit; this file is a signed envelope.\n'

/**
 * The recipient-repo-relative path an inbox signal lands at, with POSIX
 * separators — this is a *repo* path (e.g. the file a github-pr transport
 * adds), not a filesystem path. Mirrors `signalInboxPath`'s layout.
 */
export function inboxSignalRelPath(fromDid: string, id: string): string {
  return ['flyway', 'inbox', ...peerCachePathSegments(fromDid), `${id}.yaml`].join('/')
}

/**
 * Render the exact bytes of an inbox signal file. The single source of truth
 * for inbox content, shared by the local-fs write and any remote transport
 * (ADR-0012 github-pr), so a delivered signal is byte-identical on disk
 * regardless of how it arrived (ADR-0008 invariant 3).
 */
export function renderInboxSignalFile(envelope: SignedSignalEnvelope): string {
  return INBOX_HEADER + yamlStringify(envelope)
}

/**
 * Write a signal envelope to the recipient repo's inbox. Refuses to
 * overwrite an existing file whose signature differs (which would
 * indicate id reuse with different content). Re-writing identical bytes
 * is a no-op.
 */
export function writeSignalToInbox(
  recipientCwd: string,
  envelope: SignedSignalEnvelope,
): { path: string; created: boolean } {
  const path = signalInboxPath(recipientCwd, envelope.from, envelope.id)
  return writeSignalFile(path, envelope, renderInboxSignalFile(envelope))
}

/**
 * Write a signal envelope to the sender repo's outbox. Same idempotency
 * rules as the inbox.
 */
export function writeSignalToOutbox(
  senderCwd: string,
  envelope: SignedSignalEnvelope,
): { path: string; created: boolean } {
  const path = signalOutboxPath(senderCwd, envelope.to, envelope.id)
  return writeSignalFile(path, envelope, OUTBOX_HEADER + yamlStringify(envelope))
}

function writeSignalFile(
  path: string,
  envelope: SignedSignalEnvelope,
  content: string,
): { path: string; created: boolean } {
  const dir = path.substring(0, path.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  // Atomic-create-or-fail. Closes the TOCTOU window where two concurrent
  // writers (or a racing attacker) could both pass an existsSync check
  // and have the second writer overwrite without the
  // "differently-signed envelope" guard ever firing.
  try {
    writeFileSync(path, content, { flag: 'wx' })
    return { path, created: true }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    // File already exists — compare signatures. Identical re-delivery
    // is a no-op; differing signatures with the same (from, id) are an
    // attempt to overwrite history.
    const existing = readSignalFile(path)
    if (existing && existing.signature.signature === envelope.signature.signature) {
      return { path, created: false }
    }
    throw new Error(
      `writeSignal: refusing to overwrite ${path} with a differently-signed envelope (id reuse?)`,
    )
  }
}

export function readSignalFile(path: string): SignedSignalEnvelope | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed: unknown = parseDocument(raw).toJS()
    if (!parsed || typeof parsed !== 'object') return null
    if ((parsed as { schema?: unknown }).schema !== SIGNAL_SCHEMA_VERSION) return null
    return parsed as SignedSignalEnvelope
  } catch {
    return null
  }
}

/**
 * Walk `root` and return every `.yaml` file path. Stable sorted output.
 * Used by `flyway_check` and `flyway_respond` to enumerate the inbox
 * tree. Dot-prefixed files and entries that fail stat are skipped.
 */
export function collectYamlFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  let dir: string | undefined
  while ((dir = stack.pop()) !== undefined) {
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

/**
 * Find the first signal in `<cwd>/flyway/inbox/` whose envelope id
 * matches. "First" is defined by `collectYamlFiles`' sorted output; if
 * two files share an id (which would itself be a protocol violation),
 * the lexicographically-earlier path wins. Returns null when no match
 * is found or the inbox directory does not exist.
 */
export function findInboxSignalById(cwd: string, id: string): SignedSignalEnvelope | null {
  return findSignalById(join(cwd, 'flyway', 'inbox'), id)
}

/** Outbox counterpart of findInboxSignalById — same resolution rules. */
export function findOutboxSignalById(cwd: string, id: string): SignedSignalEnvelope | null {
  return findSignalById(join(cwd, 'flyway', 'outbox'), id)
}

function findSignalById(root: string, id: string): SignedSignalEnvelope | null {
  if (!existsSync(root)) return null
  for (const path of collectYamlFiles(root)) {
    const env = readSignalFile(path)
    if (env && env.id === id) return env
  }
  return null
}

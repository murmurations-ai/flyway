/**
 * CLI wrapper for flyway_respond (tension responses only at v0.1).
 *
 * The pure envelope construction lives in flyway-core
 * (createTensionResponse); this file owns:
 *
 *   - Loading the responder's identity from cwd.
 *   - Resolving the peer (response target) from a local repo path.
 *   - Reading the responder's inbox to find the subject signal.
 *   - Cross-checking that the subject signal's sender matches the
 *     peer-repo-path's DID (refuses on "wrong peer for this subject").
 *   - Verifying the subject signal's signature before responding —
 *     refuse to send a signed acknowledgement of a tampered tension.
 *   - Writing the response to the responder's outbox first
 *     (durable record), then delivering to the peer's inbox via the
 *     ADR-0008 local-fs transport.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  type TensionDecision,
  createTensionResponse,
  localEd25519Signer,
  peerCachePathSegments,
  readSignalFile,
  verifySignedSignal,
  writeSignalToInbox,
  writeSignalToOutbox,
} from '@murmurations-ai/flyway-core'
import { readPeersFile } from './recognize.js'

export interface RunRespondOptions {
  /** Where this Source's identity lives (the responder). */
  readonly cwd: string
  /** Absolute path to the peer's repo — the one whose signal we're replying to. */
  readonly peerRepoPath: string
  /** The id of the signal we are responding to (from flyway_check output). */
  readonly subjectId: string
  /** Tension decision. Proposal decisions are not yet wired. */
  readonly decision: TensionDecision
  /** Reason — required when decision is dispute / dissolve / transfer. */
  readonly reason?: string
  /** DID to transfer the tension to — required when decision is 'transfer'. */
  readonly transferTo?: string
}

export interface RunRespondResult {
  readonly response: SignedSignalEnvelope
  readonly peerDid: string
  /** The subject signal we responded to, as read from our inbox. */
  readonly subject: SignedSignalEnvelope
  readonly outboxPath: string
  readonly inboxPath: string
}

export async function runRespond(options: RunRespondOptions): Promise<RunRespondResult> {
  const { cwd, peerRepoPath, subjectId, decision } = options

  // 1. Load our identity.
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
        `flyway respond: missing our ${label} at ${p}. Run \`flyway init\` first.`,
      )
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(
    readFileSync(ourStmtPath, 'utf-8'),
  ) as SignedEntityStatement
  const ourPrivateKeyPem = readFileSync(ourKeyPath, 'utf-8')

  // 2. Resolve the peer DID from their published did.json.
  const peerDidDocPath = join(peerRepoPath, '.well-known', 'did.json')
  if (!existsSync(peerDidDocPath)) {
    throw new Error(
      `flyway respond: peer DID document missing at ${peerDidDocPath}. ` +
        `Is ${peerRepoPath} a flyway-initialized repo?`,
    )
  }
  const peerDidDocument = JSON.parse(readFileSync(peerDidDocPath, 'utf-8')) as DidDocument
  const peerDid = peerDidDocument.id

  // 3. Refuse to respond to an unrecognized peer. Signing the response
  //    only makes sense if we've affirmatively engaged with them.
  const peersPath = join(cwd, 'flyway', 'peers.yaml')
  const peers = readPeersFile(peersPath)
  if (!peers.peers.some((p) => p.did === peerDid)) {
    throw new Error(
      `flyway respond: peer ${peerDid} is not recognized in ${peersPath}. ` +
        `Run \`flyway recognize ${peerRepoPath}\` first.`,
    )
  }

  // 4. Find the subject signal in our inbox by id.
  const subject = findInboxSignalById(cwd, subjectId)
  if (!subject) {
    throw new Error(
      `flyway respond: no signal with id '${subjectId}' found in ${join(cwd, 'flyway', 'inbox')}. ` +
        'Did you mean to run `flyway check` first to see what is in your inbox?',
    )
  }

  // 5. Cross-check: the subject must be from the peer we're responding to.
  if (subject.from !== peerDid) {
    throw new Error(
      `flyway respond: subject signal '${subjectId}' is from ${subject.from} but ` +
        `peer-repo-path resolves to ${peerDid}. ` +
        'Responses must go back to the sender of the subject signal.',
    )
  }

  // 6. v0.1 wires tension responses only. Refuse proposals explicitly so
  //    the failure is informative rather than a downstream domain mismatch.
  if (subject.kind !== 'tension') {
    throw new Error(
      `flyway respond: responding to '${subject.kind}' signals is not yet wired in v0.1. ` +
        'Only tension responses are supported until flyway_propose lands.',
    )
  }

  // 7. Verify the subject signal's signature before responding. We refuse
  //    to sign a response to a tampered tension — doing so would launder
  //    the broken signature into our reply chain.
  const subjectVerifies = await verifySignedSignal(subject, peerDidDocument)
  if (!subjectVerifies) {
    throw new Error(
      `flyway respond: subject signal '${subjectId}' signature does not verify against ` +
        `peer DID document. Refusing to respond to a tampered or stale tension.`,
    )
  }

  // 8. Build the signer and the signed response.
  const verificationKeyId =
    ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ourDidDocument.verificationMethod[0]!.publicKeyJwk,
    verificationKeyId,
  })
  const response = await createTensionResponse({
    from: ourEntityStatement.did,
    to: peerDid,
    body: {
      decision,
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
      ...(options.transferTo !== undefined ? { transferTo: options.transferTo } : {}),
    },
    refs: { tensionId: subjectId, inReplyTo: subjectId },
    signer,
  })

  // 9. Write outbox first, then deliver to inbox.
  const outbox = writeSignalToOutbox(cwd, response)
  const inbox = writeSignalToInbox(peerRepoPath, response)

  return {
    response,
    peerDid,
    subject,
    outboxPath: outbox.path,
    inboxPath: inbox.path,
  }
}

// ────────────────────────────────────────────────────────────────────────
// Inbox lookup helper.
// ────────────────────────────────────────────────────────────────────────

function findInboxSignalById(cwd: string, id: string): SignedSignalEnvelope | null {
  const inboxRoot = join(cwd, 'flyway', 'inbox')
  if (!existsSync(inboxRoot)) return null
  for (const path of collectYamlFiles(inboxRoot)) {
    const env = readSignalFile(path)
    if (env && env.id === id) return env
  }
  return null
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
  return out
}

/**
 * Re-export for callers (mostly: peerCachePathSegments) that want to compose
 * inbox / outbox paths without going through flyway-core directly.
 */
export { peerCachePathSegments }

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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  type TensionDecision,
  createTensionResponse,
  findInboxSignalById,
  getPrimaryVerificationKey,
  localEd25519Signer,
  peerCachePathSegments,
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

  // 2. Resolve the peer DID. The peer's *.well-known/did.json* is used
  //    only as a discovery hint (which peer does this path correspond
  //    to?). The DID document we will pass to the verifier is the
  //    recognition-time cached copy at flyway/peers/<segments>/did.json
  //    — the cached copy is the artifact we attested to when we
  //    recognized the peer. Using a freshly-read copy would let an
  //    attacker who controls peerRepoPath supply any public key.
  const peerHintPath = join(peerRepoPath, '.well-known', 'did.json')
  if (!existsSync(peerHintPath)) {
    throw new Error(
      `flyway respond: peer DID document missing at ${peerHintPath}. ` +
        `Run \`flyway init\` in ${peerRepoPath} first.`,
    )
  }
  const peerHintDidDocument = JSON.parse(readFileSync(peerHintPath, 'utf-8')) as DidDocument
  const peerDid = peerHintDidDocument.id

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

  // 4. Load the cached peer DID document — the trusted copy.
  const cachedPeerDidPath = join(
    cwd,
    'flyway',
    'peers',
    ...peerCachePathSegments(peerDid),
    'did.json',
  )
  if (!existsSync(cachedPeerDidPath)) {
    throw new Error(
      `flyway respond: cached peer DID document missing at ${cachedPeerDidPath}. ` +
        `Run \`flyway recognize ${peerRepoPath} --force\` to refresh the cache.`,
    )
  }
  const peerDidDocument = JSON.parse(readFileSync(cachedPeerDidPath, 'utf-8')) as DidDocument

  // 5. Find the subject signal in our inbox by id.
  const subject = findInboxSignalById(cwd, subjectId)
  if (!subject) {
    throw new Error(
      `flyway respond: no signal with id '${subjectId}' found in ${join(cwd, 'flyway', 'inbox')}. ` +
        'Run `flyway check` first to see what is in your inbox.',
    )
  }

  // 6. Cross-check: the subject must be from the peer we're responding to.
  if (subject.from !== peerDid) {
    throw new Error(
      `flyway respond: subject signal '${subjectId}' is from ${subject.from} but ` +
        `peer-repo-path resolves to ${peerDid}. ` +
        'Responses must go back to the sender of the subject signal.',
    )
  }

  // 7. v0.1 wires tension responses only. Refuse proposals explicitly so
  //    the failure is informative rather than a downstream domain mismatch.
  //    Core's createTensionResponse will reject this too; we surface a
  //    friendlier error here.
  if (subject.kind !== 'tension') {
    throw new Error(
      `flyway respond: responding to '${subject.kind}' signals is not yet wired in v0.1. ` +
        'Only tension responses are supported until flyway_propose lands.',
    )
  }

  // 8. Build the signer and the signed response. Antecedent verification
  //    (per ADR-0009) is performed inside createTensionResponse — passing
  //    the cached peer DID document and the subject envelope is sufficient.
  const ownVerificationMethod = getPrimaryVerificationKey(ourDidDocument)
  const verificationKeyId =
    ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ownVerificationMethod.publicKeyJwk,
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
    subjectEnvelope: subject,
    subjectSenderDidDocument: peerDidDocument,
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


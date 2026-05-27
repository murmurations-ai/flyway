/**
 * CLI wrapper for flyway_respond — kind-dispatcher.
 *
 * The pure envelope construction lives in flyway-core (createTensionResponse
 * / createProposalResponse); this file owns:
 *
 *   - Loading the responder's identity from cwd.
 *   - Resolving the peer (response target) from a local repo path.
 *   - Reading the responder's inbox to find the subject signal.
 *   - Cross-checking that the subject signal's sender matches the
 *     peer-repo-path's DID (refuses on "wrong peer for this subject").
 *   - Verifying the subject signal's signature before responding —
 *     refuse to send a signed acknowledgement of a tampered subject
 *     (per ADR-0009, performed inside the core primitives).
 *   - Dispatching by subject.kind: tension responses get the four S3
 *     tension decisions; proposal responses get accept/object/exit
 *     with concernsToRecord (Issues #3, #15).
 *   - Writing the response to the responder's outbox first
 *     (durable record), then delivering to the peer's inbox via the
 *     ADR-0008 local-fs transport.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  PROPOSAL_DECISIONS,
  type ProposalDecision,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  TENSION_DECISIONS,
  type TensionDecision,
  createProposalResponse,
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
  /**
   * Decision keyword. Must be a tension decision when responding to a
   * tension (acknowledge/dispute/dissolve/transfer) or a proposal
   * decision when responding to a proposal (accept/object/exit).
   * Validated after the subject is located.
   */
  readonly decision: TensionDecision | ProposalDecision
  /** Reason. Required for tension dispute/dissolve/transfer and for proposal object/exit. */
  readonly reason?: string
  /** DID to transfer the tension to — required when responding to a tension with decision='transfer'. */
  readonly transferTo?: string
  /** Concerns to record (Issues #3, #15). Only valid when responding to a proposal. */
  readonly concernsToRecord?: readonly string[]
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

  // 7. Build the signer once; the kind-specific branches reuse it.
  const ownVerificationMethod = getPrimaryVerificationKey(ourDidDocument)
  const verificationKeyId =
    ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ownVerificationMethod.publicKeyJwk,
    verificationKeyId,
  })

  // 8. Dispatch by subject kind. Antecedent verification is enforced
  //    inside the core primitives (ADR-0009).
  let response: SignedSignalEnvelope
  if (subject.kind === 'tension') {
    if (!(TENSION_DECISIONS as readonly string[]).includes(decision)) {
      throw new Error(
        `flyway respond: decision '${decision}' is not a tension decision. ` +
          `Tension decisions are ${TENSION_DECISIONS.join(', ')}.`,
      )
    }
    if (options.concernsToRecord !== undefined) {
      throw new Error(
        'flyway respond: --concerns-to-record is only valid when responding to a proposal.',
      )
    }
    response = await createTensionResponse({
      from: ourEntityStatement.did,
      to: peerDid,
      body: {
        decision: decision as TensionDecision,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        ...(options.transferTo !== undefined ? { transferTo: options.transferTo } : {}),
      },
      refs: { tensionId: subjectId, inReplyTo: subjectId },
      subjectEnvelope: subject,
      subjectSenderDidDocument: peerDidDocument,
      signer,
    })
  } else if (subject.kind === 'proposal') {
    if (!(PROPOSAL_DECISIONS as readonly string[]).includes(decision)) {
      throw new Error(
        `flyway respond: decision '${decision}' is not a proposal decision. ` +
          `Proposal decisions are ${PROPOSAL_DECISIONS.join(', ')}.`,
      )
    }
    if (options.transferTo !== undefined) {
      throw new Error(
        'flyway respond: --transfer-to is only valid when responding to a tension.',
      )
    }
    response = await createProposalResponse({
      from: ourEntityStatement.did,
      to: peerDid,
      body: {
        decision: decision as ProposalDecision,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        ...(options.concernsToRecord !== undefined
          ? { concernsToRecord: options.concernsToRecord }
          : {}),
      },
      refs: { proposalId: subjectId, inReplyTo: subjectId },
      subjectEnvelope: subject,
      subjectSenderDidDocument: peerDidDocument,
      signer,
    })
  } else {
    throw new Error(
      `flyway respond: cannot respond to '${subject.kind}' signals. ` +
        `Only tension and proposal subjects are wired.`,
    )
  }

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


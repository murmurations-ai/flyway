/**
 * CLI wrapper for flyway_exit — deliver a signed exit notice to a peer.
 * The pure envelope construction lives in flyway-core (createExit); this
 * file owns:
 *
 *   - Loading the exiting Source's identity from cwd.
 *   - Resolving the recipient peer via a local filesystem path
 *     (v0.1 local-fs transport, per ADR-0008).
 *   - The recognized-peer trust gate — you can only exit a relationship
 *     you affirmatively entered.
 *   - Defaulting `target` to the peer DID for a peer exit (the peer is
 *     resolvable from the repo path; the operator shouldn't have to
 *     retype the DID).
 *   - Writing the signed exit to the sender's outbox first (the exit must
 *     be recorded even if delivery fails), then delivering to the peer's
 *     inbox.
 *
 * Exit does NOT touch peers.yaml or any co-signed agreement file: it is a
 * superseding record, not a retraction of recognition or a mutation of
 * signed artifacts. (See the flyway-core exit module header.)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type ExitBody,
  type DeliveryReceipt,
  type ExitTargetType,
  type SignalRefs,
  type SignalTransport,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  createExit,
  getPrimaryVerificationKey,
  localEd25519Signer,
  sendSignal,
} from '@murmurations-ai/flyway-core'
import { readPeersFile } from './recognize.js'

export interface RunExitOptions {
  /** Where this Source's identity lives. */
  readonly cwd: string
  /** Absolute path to the recipient peer's repo (delivery target). */
  readonly peerRepoPath: string
  /** What is being exited. */
  readonly targetType: ExitTargetType
  /**
   * The target id. Optional for targetType='peer' (defaults to the
   * resolved peer DID); required for project / syndicate.
   */
  readonly target?: string
  /** Optional reason shared with the peer. */
  readonly reason?: string
  /** Optional cross-signal references. */
  readonly refs?: SignalRefs
  /** Delivery transport; defaults to local-fs. */
  readonly transport?: SignalTransport
}

export interface RunExitResult {
  readonly signal: SignedSignalEnvelope
  readonly peerDid: string
  readonly outboxPath: string
  readonly inboxPath: string
  readonly receipt: DeliveryReceipt
}

export async function runExit(options: RunExitOptions): Promise<RunExitResult> {
  const { cwd, peerRepoPath, targetType } = options

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
      throw new Error(`flyway exit: missing our ${label} at ${p}. Run \`flyway init\` first.`)
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(readFileSync(ourStmtPath, 'utf-8')) as SignedEntityStatement
  const ourPrivateKeyPem = readFileSync(ourKeyPath, 'utf-8')

  // 2. Resolve the peer DID from their published did.json.
  const peerDidDocPath = join(peerRepoPath, '.well-known', 'did.json')
  if (!existsSync(peerDidDocPath)) {
    throw new Error(
      `flyway exit: peer DID document missing at ${peerDidDocPath}. ` +
        `Run \`flyway init\` in ${peerRepoPath} first, or point at the peer's initialized repo.`,
    )
  }
  const peerDidDocument = JSON.parse(readFileSync(peerDidDocPath, 'utf-8')) as DidDocument
  const peerDid = peerDidDocument.id

  // 3. Recognized-peer trust gate — you can only exit a relationship you
  //    affirmatively entered.
  const peersPath = join(cwd, 'flyway', 'peers.yaml')
  const peers = readPeersFile(peersPath)
  if (!peers.peers.some((p) => p.did === peerDid)) {
    throw new Error(
      `flyway exit: peer ${peerDid} is not recognized in ${peersPath}. ` +
        `There is no relationship to exit (run \`flyway recognize ${peerRepoPath}\` first if this is unexpected).`,
    )
  }

  // 4. Resolve the target. For a peer exit, default to the peer DID; for
  //    project/syndicate, the caller must say which one.
  let target = options.target
  if (target === undefined) {
    if (targetType === 'peer') {
      target = peerDid
    } else {
      throw new Error(
        `flyway exit: --target is required for targetType='${targetType}' ` +
          '(the id of the project or syndicate to exit).',
      )
    }
  }

  // 5. Build the signer and the signed exit envelope.
  const ownVerificationMethod = getPrimaryVerificationKey(ourDidDocument)
  const verificationKeyId = ourEntityStatement.verificationKeyId
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ownVerificationMethod.publicKeyJwk,
    verificationKeyId,
  })
  const body: ExitBody = {
    target,
    targetType,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  }
  const signal = await createExit({
    from: ourEntityStatement.did,
    to: peerDid,
    body,
    signer,
    ...(options.refs !== undefined ? { refs: options.refs } : {}),
  })

  // 6. Outbox-first delivery via the transport (local-fs by default).
  const { outboxPath, receipt } = await sendSignal({
    cwd,
    signal,
    target: { toDid: peerDid, localRepoPath: peerRepoPath },
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
  })

  return {
    signal,
    peerDid,
    outboxPath,
    inboxPath: receipt.ref ?? '',
    receipt,
  }
}

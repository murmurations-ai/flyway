/**
 * CLI wrapper for flyway_tension — sender side of the first cross-murmuration
 * signal. The pure envelope construction lives in flyway-core (createTension);
 * this file owns:
 *
 *   - Loading the sender's identity from cwd.
 *   - Looking up the peer in flyway/peers.yaml (refuses to send to
 *     unrecognized peers — recognition is the trust gate).
 *   - Resolving the recipient via a local filesystem path
 *     (v0.1 local-fs transport, per ADR-0008).
 *   - Writing the signed envelope to the sender's outbox first
 *     (sending must be recorded even if delivery fails) and then
 *     delivering to the recipient's inbox.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type DeliveryReceipt,
  type SignalRefs,
  type SignalTransport,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  type TensionBody,
  createTension,
  getPrimaryVerificationKey,
  localEd25519Signer,
  sendSignal,
} from '@murmurations-ai/flyway-core'
import { readPeersFile } from './recognize.js'

export interface RunTensionOptions {
  /** Where this Source's identity lives. */
  readonly cwd: string
  /**
   * Absolute path to the recipient peer's repo. Must contain
   * .well-known/did.json (so we can resolve the peer DID) and is the
   * delivery target for the local-fs transport.
   */
  readonly peerRepoPath: string
  /** The tension itself. */
  readonly body: TensionBody
  /** Optional cross-signal references (e.g. inReplyTo). */
  readonly refs?: SignalRefs
  /** Delivery transport; defaults to local-fs. */
  readonly transport?: SignalTransport
}

export interface RunTensionResult {
  readonly signal: SignedSignalEnvelope
  readonly peerDid: string
  readonly outboxPath: string
  readonly inboxPath: string
  readonly receipt: DeliveryReceipt
}

export async function runTension(options: RunTensionOptions): Promise<RunTensionResult> {
  const { cwd, peerRepoPath, body } = options

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
      throw new Error(`flyway tension: missing our ${label} at ${p}. Run \`flyway init\` first.`)
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(readFileSync(ourStmtPath, 'utf-8')) as SignedEntityStatement
  const ourPrivateKeyPem = readFileSync(ourKeyPath, 'utf-8')

  // 2. Resolve the peer DID from their published did.json.
  const peerDidDocPath = join(peerRepoPath, '.well-known', 'did.json')
  if (!existsSync(peerDidDocPath)) {
    throw new Error(
      `flyway tension: peer DID document missing at ${peerDidDocPath}. ` +
        `Run \`flyway init\` in ${peerRepoPath} first, or point at the peer's initialized repo.`,
    )
  }
  const peerDidDocument = JSON.parse(readFileSync(peerDidDocPath, 'utf-8')) as DidDocument
  const peerDid = peerDidDocument.id

  // 3. Refuse to send to an unrecognized peer. Recognition is the trust
  //    gate — we never deliver signed signals to a Source we have not
  //    affirmatively committed to engaging with.
  const peersPath = join(cwd, 'flyway', 'peers.yaml')
  const peers = readPeersFile(peersPath)
  if (!peers.peers.some((p) => p.did === peerDid)) {
    throw new Error(
      `flyway tension: peer ${peerDid} is not recognized in ${peersPath}. ` +
        `Run \`flyway recognize ${peerRepoPath}\` first.`,
    )
  }

  // 4. Build the signer and the signed envelope.
  const ownVerificationMethod = getPrimaryVerificationKey(ourDidDocument)
  const verificationKeyId = ourEntityStatement.verificationKeyId
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ownVerificationMethod.publicKeyJwk,
    verificationKeyId,
  })
  const signal = await createTension({
    from: ourEntityStatement.did,
    to: peerDid,
    body,
    signer,
    ...(options.refs !== undefined ? { refs: options.refs } : {}),
  })

  // 5. Outbox-first delivery via the transport (local-fs by default).
  //    The outbox record is durable even if delivery fails.
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

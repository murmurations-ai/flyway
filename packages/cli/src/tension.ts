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
  type SignalRefs,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  type TensionBody,
  createTension,
  localEd25519Signer,
  writeSignalToInbox,
  writeSignalToOutbox,
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
}

export interface RunTensionResult {
  readonly signal: SignedSignalEnvelope
  readonly peerDid: string
  readonly outboxPath: string
  readonly inboxPath: string
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
      throw new Error(
        `flyway tension: missing our ${label} at ${p}. Run \`flyway init\` first.`,
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
      `flyway tension: peer DID document missing at ${peerDidDocPath}. ` +
        `Is ${peerRepoPath} a flyway-initialized repo?`,
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
  const verificationKeyId =
    ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ourDidDocument.verificationMethod[0]!.publicKeyJwk,
    verificationKeyId,
  })
  const signal = await createTension({
    from: ourEntityStatement.did,
    to: peerDid,
    body,
    signer,
    ...(options.refs !== undefined ? { refs: options.refs } : {}),
  })

  // 5. Write outbox first (sender's record), then deliver to inbox.
  //    Outbox must be durable even if the delivery step fails.
  const outbox = writeSignalToOutbox(cwd, signal)
  const inbox = writeSignalToInbox(peerRepoPath, signal)

  return {
    signal,
    peerDid,
    outboxPath: outbox.path,
    inboxPath: inbox.path,
  }
}

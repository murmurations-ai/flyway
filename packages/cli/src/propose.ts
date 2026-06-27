/**
 * CLI wrapper for flyway_propose — second sender (the flagship).
 *
 * The pure envelope construction lives in flyway-core (createProposal);
 * this file owns:
 *   - Loading the sender's identity from cwd.
 *   - Recognized-peer trust gate.
 *   - Resolving antecedents from disk: tension promotion reads the
 *     prior tension from either our outbox (we surfaced it) or our
 *     inbox (the peer raised it); chain continuation reads the prior
 *     proposal from our outbox.
 *   - ADR-0009: loads the antecedent sender's DID document from the
 *     recognition-time cache, not from any peer-controlled path.
 *   - Writing the signed envelope to the sender's outbox first, then
 *     delivering via the ADR-0008 local-fs transport.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type DeliveryReceipt,
  type ProposalBody,
  type SignalTransport,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  createProposal,
  findInboxSignalById,
  getPrimaryVerificationKey,
  localEd25519Signer,
  peerCachePathSegments,
  readSignalFile,
  sendSignal,
  signalOutboxPath,
} from '@murmurations-ai/flyway-core'
import { readPeersFile } from './recognize.js'

export interface RunProposeOptions {
  /** Where this Source's identity lives. */
  readonly cwd: string
  /** Absolute path to the recipient peer's repo. */
  readonly peerRepoPath: string
  /** The proposal body (already type-discriminated). */
  readonly body: ProposalBody
  /** Optional: id of the prior tension being promoted. */
  readonly promoteTensionId?: string
  /** Optional: id of the prior proposal in a staging chain. Required if body.previousStageId is set, or if body.stage === 'refinement'. */
  readonly previousStageId?: string
  /** Delivery transport; defaults to local-fs. */
  readonly transport?: SignalTransport
}

export interface RunProposeResult {
  readonly proposal: SignedSignalEnvelope
  readonly peerDid: string
  readonly outboxPath: string
  readonly inboxPath: string
  readonly receipt: DeliveryReceipt
}

export async function runPropose(options: RunProposeOptions): Promise<RunProposeResult> {
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
        `flyway propose: missing our ${label} at ${p}. Run \`flyway init\` first.`,
      )
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(
    readFileSync(ourStmtPath, 'utf-8'),
  ) as SignedEntityStatement
  const ourPrivateKeyPem = readFileSync(ourKeyPath, 'utf-8')

  // 2. Resolve peer DID from their published did.json (discovery hint
  //    only — the actual verifying key for any antecedent comes from
  //    our recognition-time cache).
  const peerHintPath = join(peerRepoPath, '.well-known', 'did.json')
  if (!existsSync(peerHintPath)) {
    throw new Error(
      `flyway propose: peer DID document missing at ${peerHintPath}. ` +
        `Run \`flyway init\` in ${peerRepoPath} first.`,
    )
  }
  const peerHintDidDocument = JSON.parse(readFileSync(peerHintPath, 'utf-8')) as DidDocument
  const peerDid = peerHintDidDocument.id

  // 3. Recognized-peer trust gate.
  const peersPath = join(cwd, 'flyway', 'peers.yaml')
  const peers = readPeersFile(peersPath)
  if (!peers.peers.some((p) => p.did === peerDid)) {
    throw new Error(
      `flyway propose: peer ${peerDid} is not recognized in ${peersPath}. ` +
        `Run \`flyway recognize ${peerRepoPath}\` first.`,
    )
  }

  // 4. Load the cached peer DID document — the trusted copy for any
  //    antecedent verification involving the peer's signatures.
  const cachedPeerDidPath = join(
    cwd,
    'flyway',
    'peers',
    ...peerCachePathSegments(peerDid),
    'did.json',
  )
  if (!existsSync(cachedPeerDidPath)) {
    throw new Error(
      `flyway propose: cached peer DID document missing at ${cachedPeerDidPath}. ` +
        `Run \`flyway recognize ${peerRepoPath} --force\` to refresh the cache.`,
    )
  }
  const cachedPeerDidDocument = JSON.parse(
    readFileSync(cachedPeerDidPath, 'utf-8'),
  ) as DidDocument

  // 5. Resolve tension antecedent (promotion). A tension we received
  //    from the peer lives in our inbox; a tension we sent lives in our
  //    outbox. Both cases are valid for promotion: A→B tension followed
  //    by A→B proposal continues A's own driver; B→A tension followed
  //    by A→B proposal is A picking up B's surfaced concern.
  let tensionAntecedent: { envelope: SignedSignalEnvelope; senderDidDocument: DidDocument } | undefined
  if (options.promoteTensionId) {
    const fromInbox = findInboxSignalById(cwd, options.promoteTensionId)
    let tensionEnv: SignedSignalEnvelope | null = fromInbox
    let tensionSenderDoc: DidDocument
    if (fromInbox) {
      // Tension came from the peer: verify with the peer's cached DID doc.
      tensionSenderDoc = cachedPeerDidDocument
    } else {
      // Maybe we sent it — look in our outbox addressed to the peer.
      const outboxPath = signalOutboxPath(cwd, peerDid, options.promoteTensionId)
      tensionEnv = readSignalFile(outboxPath)
      tensionSenderDoc = ourDidDocument
    }
    if (!tensionEnv) {
      throw new Error(
        `flyway propose: --promote-tension-id '${options.promoteTensionId}' not found in ` +
          `our inbox or outbox. Run \`flyway check\` to list inbox signals.`,
      )
    }
    if (tensionEnv.kind !== 'tension') {
      throw new Error(
        `flyway propose: --promote-tension-id '${options.promoteTensionId}' resolves to a ` +
          `${tensionEnv.kind} signal, not a tension`,
      )
    }
    tensionAntecedent = { envelope: tensionEnv, senderDidDocument: tensionSenderDoc }
  }

  // 6. Resolve proposal antecedent (chain continuation). When continuing
  //    a stage chain, the prior proposal must be one *we* sent — chains
  //    are authored by a single Source while the other consents. We
  //    look in our outbox.
  let proposalAntecedent: { envelope: SignedSignalEnvelope; senderDidDocument: DidDocument } | undefined
  if (options.previousStageId) {
    const outboxPath = signalOutboxPath(cwd, peerDid, options.previousStageId)
    const priorProposal = readSignalFile(outboxPath)
    if (!priorProposal) {
      throw new Error(
        `flyway propose: --previous-stage-id '${options.previousStageId}' not found in ` +
          `our outbox at ${outboxPath}. Stage chains continue from proposals WE previously sent.`,
      )
    }
    if (priorProposal.kind !== 'proposal') {
      throw new Error(
        `flyway propose: --previous-stage-id '${options.previousStageId}' resolves to a ` +
          `${priorProposal.kind} signal, not a proposal`,
      )
    }
    proposalAntecedent = {
      envelope: priorProposal,
      senderDidDocument: ourDidDocument,
    }
  }

  // 7. Build the signer and the signed proposal.
  const ownVerificationMethod = getPrimaryVerificationKey(ourDidDocument)
  const verificationKeyId =
    ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ownVerificationMethod.publicKeyJwk,
    verificationKeyId,
  })
  // If the caller passed previousStageId at the CLI level, mirror it
  // into the body so core's validation enforces the chain rules.
  const effectiveBody: ProposalBody = options.previousStageId
    ? ({ ...body, previousStageId: options.previousStageId } as ProposalBody)
    : body
  const proposal = await createProposal({
    from: ourEntityStatement.did,
    to: peerDid,
    body: effectiveBody,
    signer,
    ...(tensionAntecedent ? { tensionAntecedent } : {}),
    ...(proposalAntecedent ? { proposalAntecedent } : {}),
  })

  // 8. Outbox-first delivery via the transport (local-fs by default).
  const { outboxPath, receipt } = await sendSignal({
    cwd,
    signal: proposal,
    target: { toDid: peerDid, localRepoPath: peerRepoPath },
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
  })

  return {
    proposal,
    peerDid,
    outboxPath,
    inboxPath: receipt.ref ?? '',
    receipt,
  }
}

/**
 * CLI wrapper for agreement materialization (S+5b).
 *
 * The pure construction lives in flyway-core (materializeAgreement); this
 * file owns:
 *
 *   - Loading the local Source's identity from cwd.
 *   - Resolving the peer and loading the recognition-time cached DID
 *     document (the trusted copy — never a fresh read from the peer repo).
 *   - Locating the final agreement proposal and the accept response in
 *     this repo's outbox/inbox (whichever side this Source was on, both
 *     records are already here; that is the point of materialization —
 *     no further communication is needed).
 *   - Mapping proposer/responder to our-side / peer-side DID documents.
 *   - Writing flyway/agreements/<id>.yaml and reporting the sha256 so the
 *     two Sources can compare byte-identity out of band.
 *
 * Both participants run the same command in their own repos and obtain
 * byte-identical files. There is no delivery step: materialization is a
 * local act over records already exchanged.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type MaterializedAgreement,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  findInboxSignalById,
  findOutboxSignalById,
  materializeAgreement,
  peerCachePathSegments,
  writeAgreementFile,
} from '@murmurations-ai/flyway-core'
import { readPeersFile } from './recognize.js'

export interface RunMaterializeOptions {
  /** Where this Source's identity lives. */
  readonly cwd: string
  /** Absolute path to the peer's repo — the other participant. */
  readonly peerRepoPath: string
  /** Id of the accept response that closed the consent round. */
  readonly responseId: string
  /**
   * Id of the final agreement proposal. Optional — when omitted it is
   * resolved from the response's refs.proposalId.
   */
  readonly proposalId?: string
}

export interface RunMaterializeResult {
  readonly materialized: MaterializedAgreement
  readonly peerDid: string
  readonly path: string
  /** False when the file already existed with identical bytes (idempotent re-run). */
  readonly created: boolean
}

export async function runMaterialize(
  options: RunMaterializeOptions,
): Promise<RunMaterializeResult> {
  const { cwd, peerRepoPath, responseId } = options

  // 1. Load our identity.
  const ourDidDocPath = join(cwd, '.well-known', 'did.json')
  const ourStmtPath = join(cwd, 'flyway', 'entity-statement.json')
  for (const [label, p] of [
    ['DID document', ourDidDocPath] as const,
    ['entity statement', ourStmtPath] as const,
  ]) {
    if (!existsSync(p)) {
      throw new Error(
        `flyway materialize: missing our ${label} at ${p}. Run \`flyway init\` first.`,
      )
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(
    readFileSync(ourStmtPath, 'utf-8'),
  ) as SignedEntityStatement
  const ourDid = ourEntityStatement.did

  // 2. Resolve the peer DID (discovery hint only — the trusted DID
  //    document is the recognition-time cache).
  const peerHintPath = join(peerRepoPath, '.well-known', 'did.json')
  if (!existsSync(peerHintPath)) {
    throw new Error(
      `flyway materialize: peer DID document missing at ${peerHintPath}. ` +
        `Run \`flyway init\` in ${peerRepoPath} first.`,
    )
  }
  const peerDid = (JSON.parse(readFileSync(peerHintPath, 'utf-8')) as DidDocument).id

  // 3. The peer must be recognized — an agreement with an unrecognized
  //    party should never have gotten this far, but the gate is cheap.
  const peersPath = join(cwd, 'flyway', 'peers.yaml')
  const peers = readPeersFile(peersPath)
  if (!peers.peers.some((p) => p.did === peerDid)) {
    throw new Error(
      `flyway materialize: peer ${peerDid} is not recognized in ${peersPath}. ` +
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
      `flyway materialize: cached peer DID document missing at ${cachedPeerDidPath}. ` +
        `Run \`flyway recognize ${peerRepoPath} --force\` to refresh the cache.`,
    )
  }
  const peerDidDocument = JSON.parse(readFileSync(cachedPeerDidPath, 'utf-8')) as DidDocument

  // 5. Locate the response — ours (outbox) or theirs (inbox).
  const response = findLocalSignalById(cwd, responseId)
  if (!response) {
    throw new Error(
      `flyway materialize: no signal with id '${responseId}' found in this repo's ` +
        'outbox or inbox. Run `flyway check` to see what has been exchanged.',
    )
  }

  // 6. Locate the proposal — from the flag or the response's refs.
  const proposalId = options.proposalId ?? response.refs?.proposalId
  if (!proposalId) {
    throw new Error(
      `flyway materialize: response '${responseId}' has no refs.proposalId and ` +
        'no --proposal-id was given — cannot identify the agreement proposal.',
    )
  }
  const proposal = findLocalSignalById(cwd, proposalId)
  if (!proposal) {
    throw new Error(
      `flyway materialize: no signal with id '${proposalId}' found in this repo's ` +
        'outbox or inbox.',
    )
  }

  // 7. Map proposer/responder onto our-side / peer-side DID documents.
  //    Exactly one of the two envelopes is ours; the other is the peer's.
  const didDocumentFor = (did: string): DidDocument => {
    if (did === ourDid) return ourDidDocument
    if (did === peerDid) return peerDidDocument
    throw new Error(
      `flyway materialize: signal sender ${did} is neither this Source (${ourDid}) ` +
        `nor the peer (${peerDid}). Wrong peer repo path for this agreement?`,
    )
  }

  // 8. Verify + assemble (ADR-0009 checks live in the core primitive),
  //    then write our copy.
  const materialized = await materializeAgreement({
    proposalEnvelope: proposal,
    responseEnvelope: response,
    proposerDidDocument: didDocumentFor(proposal.from),
    responderDidDocument: didDocumentFor(response.from),
  })
  const { path, created } = writeAgreementFile(cwd, materialized)

  return { materialized, peerDid, path, created }
}

function findLocalSignalById(cwd: string, id: string): SignedSignalEnvelope | null {
  return findOutboxSignalById(cwd, id) ?? findInboxSignalById(cwd, id)
}

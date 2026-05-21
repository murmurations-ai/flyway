/**
 * CLI wrapper for unrecognize. Produces a signed unrecognition record,
 * removes the peer from peers.yaml, and keeps the peer cache directory
 * intact for audit.
 *
 * Unrecognize is the lightweight, unilateral counterpart to recognize:
 * "I no longer recognize this peer." Heavyweight exit from an active
 * agreement is the (planned) flyway_exit tool's job and may subsume this
 * verb at the protocol level later. For v0.1, unrecognize is a CLI-only
 * administrative verb backed by a signed record so the *act* is
 * verifiable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DidDocument,
  type SignedEntityStatement,
  type SignedUnrecognitionRecord,
  localEd25519Signer,
  unrecognizePeer,
} from '@murmurations-ai/flyway-core'
import { stringify as yamlStringify } from 'yaml'
import { readPeersFile, serializePeersFile } from './recognize.js'

export interface RunUnrecognizeOptions {
  readonly cwd: string
  readonly peerDid: string
  readonly reason?: string
}

export interface RunUnrecognizeResult {
  readonly peerDid: string
  readonly record: SignedUnrecognitionRecord
  readonly recordPath: string
  readonly peersFilePath: string
}

export async function runUnrecognize(
  options: RunUnrecognizeOptions,
): Promise<RunUnrecognizeResult> {
  const { cwd, peerDid } = options

  // 1. Load OUR identity.
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
        `flyway unrecognize: missing our ${label} at ${p}. Run \`flyway init\` first.`,
      )
    }
  }
  const ourDidDocument = JSON.parse(readFileSync(ourDidDocPath, 'utf-8')) as DidDocument
  const ourEntityStatement = JSON.parse(
    readFileSync(ourStmtPath, 'utf-8'),
  ) as SignedEntityStatement
  const ourPrivateKeyPem = readFileSync(ourKeyPath, 'utf-8')

  // 2. Find the peer in peers.yaml.
  const peersFilePath = join(cwd, 'flyway', 'peers.yaml')
  const peersFile = readPeersFile(peersFilePath)
  const idx = peersFile.peers.findIndex((p) => p.did === peerDid)
  if (idx < 0) {
    throw new Error(
      `flyway unrecognize: peer ${peerDid} is not currently in ${peersFilePath}.`,
    )
  }
  const priorEntry = peersFile.peers[idx]!

  // 3. Build a signer and produce a signed unrecognition record.
  const signer = localEd25519Signer({
    privateKeyPem: ourPrivateKeyPem,
    publicKeyJwk: ourDidDocument.verificationMethod[0]!.publicKeyJwk,
    verificationKeyId:
      ourEntityStatement.verificationKeyId ?? `${ourEntityStatement.did}#key-1`,
  })
  const record = await unrecognizePeer({
    priorEntry,
    unrecognizedByDid: ourEntityStatement.did,
    signer,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  })

  // 4. Write the unrecognition record (audit trail).
  const safeDid = peerDid.replace(/[:/]/g, '_')
  const unrecognizedDir = join(cwd, 'flyway', 'unrecognized')
  mkdirSync(unrecognizedDir, { recursive: true })
  const recordPath = join(unrecognizedDir, `${safeDid}.yaml`)
  const header =
    '# flyway unrecognition record — signed evidence that this Source\n' +
    `# withdrew recognition of ${peerDid}.\n` +
    '# The corresponding entry has been removed from flyway/peers.yaml;\n' +
    '# the peer cache under flyway/peers/ is intentionally retained for audit.\n'
  writeFileSync(recordPath, header + yamlStringify(record))

  // 5. Remove the entry from peers.yaml.
  peersFile.peers.splice(idx, 1)
  writeFileSync(peersFilePath, serializePeersFile(peersFile))

  return { peerDid, record, recordPath, peersFilePath }
}

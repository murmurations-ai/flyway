/**
 * Pure logic for flyway_init — producing a flyway identity:
 *   - a did:web DID derived from a GitHub repo URL
 *   - a DID document (W3C DID core) with a JsonWebKey2020 verification method
 *   - an entity statement carrying Source metadata, signed by the Source key
 *   - an ed25519 keypair (real keys)
 *
 * This module does NOT write files. It returns artifacts. The CLI and MCP
 * adapters are responsible for filesystem placement.
 *
 * Scope for v0.1:
 *   - Only HTTPS GitHub URLs are accepted
 *   - DID resolution mechanism (web-hosting the .well-known/did.json) is the
 *     Source's responsibility — typically via GitHub Pages or raw access
 *   - The entity statement is signed inline (per ADR-0007) using the
 *     generated ed25519 key, via the local signer default
 */

import { generateKeyPairSync } from 'node:crypto'
import { FLYWAY_AGREEMENT_SCHEMA_VERSION } from './agreements.js'
import {
  DOMAIN_ENTITY_STATEMENT,
  type SignatureEnvelope,
  localEd25519Signer,
  signArtifactInline,
} from './signing.js'
import { FLYWAY_PROTOCOL_VERSION } from './skill.js'
import { FLYWAY_TOOLS } from './tools.js'

export interface PublicKeyJwk {
  readonly kty: 'OKP'
  readonly crv: 'Ed25519'
  readonly x: string // base64url-encoded 32-byte raw public key
}

export interface FlywayKeypair {
  readonly publicKeyJwk: PublicKeyJwk
  readonly privateKeyPem: string // PKCS#8 PEM
}

export interface DidVerificationMethod {
  readonly id: string
  readonly type: 'JsonWebKey2020'
  readonly controller: string
  readonly publicKeyJwk: PublicKeyJwk
}

export interface DidDocument {
  readonly '@context': readonly string[]
  readonly id: string
  readonly verificationMethod: readonly DidVerificationMethod[]
  readonly authentication: readonly string[]
}

/**
 * Return the primary verification method of a DID document. Throws with
 * a descriptive error if the document has none — better than the cryptic
 * `TypeError` you'd get from a `!` non-null assertion on
 * `verificationMethod[0]`. v0.1 always treats `verificationMethod[0]`
 * as the primary key; rotation policy lives outside this helper.
 */
export function getPrimaryVerificationKey(doc: DidDocument): DidVerificationMethod {
  const vm = doc.verificationMethod[0]
  if (!vm) {
    throw new Error(`getPrimaryVerificationKey: DID document ${doc.id} has no verificationMethod`)
  }
  return vm
}

export type FlywayMode = 'persistent' | 'interactive' | 'async' | 'ephemeral'

export interface EntityStatement {
  readonly did: string
  readonly sourceName: string
  readonly mode: FlywayMode
  readonly flywayProtocolVersion: string
  readonly createdAt: string
  readonly verificationKeyId: string
  readonly toolsSupported: readonly string[]
  readonly schemasSupported: readonly string[]
}

export interface SignedEntityStatement extends EntityStatement {
  readonly signature: SignatureEnvelope
}

export interface FlywayInitInput {
  readonly repoUrl: string
  readonly sourceName: string
  readonly mode: FlywayMode
}

export interface FlywayInitArtifacts {
  readonly did: string
  readonly didDocument: DidDocument
  readonly entityStatement: SignedEntityStatement
  readonly keypair: FlywayKeypair
}

const GITHUB_REPO_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/

export interface ParsedRepoUrl {
  readonly host: string
  readonly owner: string
  readonly repo: string
}

export function parseRepoUrl(repoUrl: string): ParsedRepoUrl {
  const match = GITHUB_REPO_URL.exec(repoUrl)
  if (!match) {
    throw new Error(
      `repoUrl must be an https GitHub URL like https://github.com/owner/repo (got: ${repoUrl})`,
    )
  }
  const owner = match[1]
  const repo = match[2]
  if (!owner || !repo) {
    throw new Error(`repoUrl parsed but missing owner or repo (got: ${repoUrl})`)
  }
  return { host: 'github.com', owner, repo }
}

export function deriveDid(parsed: ParsedRepoUrl): string {
  return `did:web:${parsed.host}:${parsed.owner}:${parsed.repo}`
}

export function generateEd25519Keypair(): FlywayKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as {
    kty: string
    crv: string
    x: string
  }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new Error(`unexpected JWK shape for ed25519 public key: ${JSON.stringify(jwk)}`)
  }
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string
  return {
    publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    privateKeyPem,
  }
}

export function buildDidDocument(did: string, keypair: FlywayKeypair): DidDocument {
  const keyId = `${did}#key-1`
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
    id: did,
    verificationMethod: [
      {
        id: keyId,
        type: 'JsonWebKey2020',
        controller: did,
        publicKeyJwk: keypair.publicKeyJwk,
      },
    ],
    authentication: [keyId],
  }
}

export function buildEntityStatement(
  did: string,
  input: FlywayInitInput,
  createdAt: Date = new Date(),
): EntityStatement {
  return {
    did,
    sourceName: input.sourceName,
    mode: input.mode,
    flywayProtocolVersion: FLYWAY_PROTOCOL_VERSION,
    createdAt: createdAt.toISOString(),
    verificationKeyId: `${did}#key-1`,
    toolsSupported: FLYWAY_TOOLS.map((t) => t.name),
    schemasSupported: [`agreement@${FLYWAY_AGREEMENT_SCHEMA_VERSION}`],
  }
}

export async function flywayInit(input: FlywayInitInput): Promise<FlywayInitArtifacts> {
  const parsed = parseRepoUrl(input.repoUrl)
  const did = deriveDid(parsed)
  const keypair = generateEd25519Keypair()
  const didDocument = buildDidDocument(did, keypair)
  const unsigned = buildEntityStatement(did, input)
  const signer = localEd25519Signer({
    privateKeyPem: keypair.privateKeyPem,
    publicKeyJwk: keypair.publicKeyJwk,
    verificationKeyId: `${did}#key-1`,
  })
  const entityStatement = await signArtifactInline(DOMAIN_ENTITY_STATEMENT, unsigned, signer)
  return { did, didDocument, entityStatement, keypair }
}

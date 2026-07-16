/**
 * did:web resolution for recognize-at-a-distance (v0.2a).
 *
 * `flyway_recognize` needs a peer's DID document + signed entity statement.
 * v0.1 read them from a local repo path; this resolves them over HTTPS from
 * the peer's `did:web` identifier so a Source can recognize a peer it has
 * never shared a filesystem with.
 *
 * Convention (ADR-0011): flyway identities are `did:web:github.com:owner:repo`,
 * which standard did:web maps to `https://github.com/owner/repo/did.json` —
 * a path GitHub does not serve. So for github.com-hosted murmurations we
 * resolve to the raw.githubusercontent URLs of the files the repo already
 * commits. Other hosts are not yet supported.
 *
 * Pre-trust: documents are returned as fetched. `recognizePeer` performs the
 * cryptographic verification — resolution only locates and sanity-checks.
 */

import { type HttpsFetchDeps, fetchTextOverHttps } from './http.js'
import type { DidDocument, SignedEntityStatement } from './init.js'

export interface DidWebResolutionUrls {
  readonly didDocUrl: string
  readonly entityStatementUrl: string
}

export interface ResolvePeerOptions extends HttpsFetchDeps {
  /** Branch to read raw GitHub content from. Default 'main'. */
  readonly branch?: string
}

export interface ResolvedPeerIdentity {
  readonly didDocument: DidDocument
  readonly entityStatement: SignedEntityStatement
  readonly didDocUrl: string
  readonly entityStatementUrl: string
}

const DID_WEB_PREFIX = 'did:web:'
const DEFAULT_BRANCH = 'main'

/** decodeURIComponent that rethrows malformed input as a diagnosable flyway error. */
function safeDecode(segment: string, did: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new Error(`flyway resolve: '${did}' contains an invalid percent-encoded segment`)
  }
}

/** Parse a did:web into its host and path segments (colons → path, per did:web). */
function parseDidWeb(did: string): { host: string; segments: string[] } {
  if (!did.startsWith(DID_WEB_PREFIX)) {
    throw new Error(`flyway resolve: '${did}' is not a did:web identifier`)
  }
  const parts = did
    .slice(DID_WEB_PREFIX.length)
    .split(':')
    .filter((p) => p.length > 0)
  const host = parts[0]
  if (host === undefined) {
    throw new Error(`flyway resolve: '${did}' has no host segment`)
  }
  return {
    host: safeDecode(host, did),
    segments: parts.slice(1).map((s) => safeDecode(s, did)),
  }
}

/**
 * Map a `did:web:github.com:<owner>:<repo>` to its GitHub owner/repo pair.
 * The single place the github.com host + 2-segment convention (ADR-0011) is
 * enforced; both HTTPS identity resolution and the github-pr transport
 * (ADR-0012) resolve their target repo through here.
 */
export function githubRepoForDid(did: string): { owner: string; repo: string } {
  const { host, segments } = parseDidWeb(did)
  if (host !== 'github.com') {
    throw new Error(
      'flyway resolve: remote resolution is only implemented for did:web:github.com:* ' +
        `(got host '${host}'). See ADR-0011.`,
    )
  }
  if (segments.length !== 2) {
    throw new Error(
      `flyway resolve: expected did:web:github.com:<owner>:<repo> ` +
        `(got ${String(segments.length)} path segments in '${did}')`,
    )
  }
  const [owner, repo] = segments as [string, string]
  return { owner, repo }
}

/**
 * Map a did:web to the URLs of its published identity artifacts, using the
 * raw.githubusercontent convention for github.com-hosted murmurations
 * (ADR-0011). Non-github hosts are not yet supported.
 */
export function didWebResolutionUrls(
  did: string,
  branch: string = DEFAULT_BRANCH,
): DidWebResolutionUrls {
  const { owner, repo } = githubRepoForDid(did)
  // encodeURIComponent is the injection guard: it percent-encodes '/', '@',
  // ':' etc., so a crafted owner/repo/branch cannot change the host or escape
  // the path. The host is a fixed literal; only the path is interpolated.
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}`
  return {
    didDocUrl: `${base}/.well-known/did.json`,
    entityStatementUrl: `${base}/flyway/entity-statement.json`,
  }
}

/**
 * Resolve and fetch a peer's identity artifacts over HTTPS. Returns them as
 * fetched; the caller verifies. A cheap id-consistency check fails fast on an
 * obviously-wrong document before the crypto step in `recognizePeer`.
 */
export async function resolvePeerIdentity(
  did: string,
  options: ResolvePeerOptions = {},
): Promise<ResolvedPeerIdentity> {
  const { didDocUrl, entityStatementUrl } = didWebResolutionUrls(
    did,
    options.branch ?? DEFAULT_BRANCH,
  )
  const [didDocText, stmtText] = await Promise.all([
    fetchTextOverHttps(didDocUrl, options),
    fetchTextOverHttps(entityStatementUrl, options),
  ])

  let didDocument: DidDocument
  try {
    didDocument = JSON.parse(didDocText) as DidDocument
  } catch (e) {
    throw new Error(`flyway resolve: ${didDocUrl} is not valid JSON: ${(e as Error).message}`)
  }
  let entityStatement: SignedEntityStatement
  try {
    entityStatement = JSON.parse(stmtText) as SignedEntityStatement
  } catch (e) {
    throw new Error(
      `flyway resolve: ${entityStatementUrl} is not valid JSON: ${(e as Error).message}`,
    )
  }

  if (didDocument.id !== did) {
    throw new Error(
      `flyway resolve: fetched DID document id (${didDocument.id}) does not match the requested did (${did})`,
    )
  }
  if (entityStatement.did !== did) {
    throw new Error(
      `flyway resolve: fetched entity statement did (${entityStatement.did}) does not match the requested did (${did})`,
    )
  }
  return { didDocument, entityStatement, didDocUrl, entityStatementUrl }
}

/**
 * CLI wrapper for flyway_discover. The pure query and the directory loader
 * both live in flyway-core (flywayDiscover / loadDirectory); this file just
 * classifies the directory argument and renders.
 *
 * Discovery is read-only and pre-trust — it needs no identity and signs
 * nothing. It reads a published directory and filters it.
 *
 * v0.2a: the directory may be a LOCAL path (YAML or JSON) or an `https://`
 * URL — the first genuinely non-local-fs operation. Remote fetch is
 * HTTPS-only and refuses private/loopback hosts (override with
 * allowPrivateDirectory for local testing). See
 * docs/architecture/remote-transports-v0.2.md.
 */

import {
  type DiscoverResult,
  type FlywayDirectory,
  flywayDiscover,
  loadDirectory,
  parseDirectoryLocation,
} from '@murmurations-ai/flyway-core'

export interface RunDiscoverOptions {
  /** A local filesystem path or an `https://` URL to a flyway directory. */
  readonly directory: string
  /** Free-text term or a full DID. Omitted lists every entry. */
  readonly query?: string
  /** Allow fetching from a loopback/private host (local testing only). */
  readonly allowPrivateDirectory?: boolean
  /** Test seam — injected fetch for remote-directory tests. */
  readonly fetchImpl?: typeof fetch
}

export interface RunDiscoverResult extends DiscoverResult {
  /** The parsed directory that was searched. */
  readonly source: FlywayDirectory
}

export async function runDiscover(options: RunDiscoverOptions): Promise<RunDiscoverResult> {
  const loc = parseDirectoryLocation(options.directory)
  const source = await loadDirectory(loc, {
    ...(options.allowPrivateDirectory ? { allowPrivate: true } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
  const result = flywayDiscover({
    directory: source,
    ...(options.query !== undefined ? { query: options.query } : {}),
  })
  return { ...result, source }
}

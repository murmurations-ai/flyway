/**
 * CLI wrapper for flyway_discover. The pure query lives in flyway-core
 * (flywayDiscover); this file owns loading and parsing the directory
 * document from disk.
 *
 * Discovery is read-only and pre-trust — it needs no identity and signs
 * nothing. It just reads a published directory and filters it.
 *
 * v0.1 reads a LOCAL directory file (YAML or JSON). Fetching a directory
 * over http(s) — the first genuinely non-local-fs operation — is reserved
 * for v0.2; a URL source is refused with a clear message rather than
 * silently treated as a path.
 */

import { existsSync, readFileSync } from 'node:fs'
import {
  type DiscoverResult,
  type FlywayDirectory,
  flywayDiscover,
  parseFlywayDirectory,
} from '@murmurations-ai/flyway-core'
import { parseDocument } from 'yaml'

export interface RunDiscoverOptions {
  /**
   * Where the directory document lives. v0.1: a local filesystem path to a
   * YAML or JSON directory file. An http(s) URL is reserved for v0.2.
   */
  readonly directory: string
  /** Free-text term or a full DID. Omitted lists every entry. */
  readonly query?: string
}

export interface RunDiscoverResult extends DiscoverResult {
  /** The parsed directory that was searched. */
  readonly source: FlywayDirectory
}

export async function runDiscover(options: RunDiscoverOptions): Promise<RunDiscoverResult> {
  const { directory } = options

  if (/^https?:\/\//i.test(directory)) {
    throw new Error(
      'flyway discover: remote directory fetch (http/https) is reserved for v0.2. ' +
        'Pass a local path to a flyway directory file for now.',
    )
  }
  if (!existsSync(directory)) {
    throw new Error(`flyway discover: directory file not found at ${directory}`)
  }

  const raw = readFileSync(directory, 'utf-8')
  let parsedDoc: unknown
  try {
    parsedDoc = parseDocument(raw).toJS()
  } catch (e) {
    throw new Error(
      `flyway discover: could not parse ${directory} as YAML/JSON: ${(e as Error).message}`,
    )
  }

  const source = parseFlywayDirectory(parsedDoc)
  const result = flywayDiscover({
    directory: source,
    ...(options.query !== undefined ? { query: options.query } : {}),
  })
  return { ...result, source }
}

/**
 * github-pr signal transport (v0.2b, ADR-0012) — the production transport
 * ADR-0008 reserved. Instead of writing into the recipient's working tree
 * (localFsTransport), the sender opens a *pull request* against the
 * recipient's repo adding the inbox file. The recipient merges under their
 * own governance: delivery becomes a proposal the receiver consents to.
 *
 * This honours every transport invariant (docs/architecture/remote-transports-v0.2.md §2):
 *   1. Outbox-first is the sender's job — `sendSignal` writes the outbox
 *      before calling this, so a `delivered: false` return (or a throw) still
 *      leaves a durable, re-sendable record. Undeliverable is NORMAL here.
 *   2. Idempotent on (from, id) — the branch name is deterministic; a PR that
 *      already exists is a no-op returning its URL. Differing bytes at the
 *      same (from, id) are refused upstream, at the sender's outbox
 *      (writeSignalToOutbox's wx + signature-compare), before any network call.
 *   3. Bytes are moved verbatim — the file content is `renderInboxSignalFile`,
 *      the exact bytes localFsTransport writes, so the signature verifies on
 *      the far side over identical bytes.
 *
 * Trust is unchanged: the PR author is *claimed*, never trusted. Recognition
 * still verifies the signature against the recipient's cached key. github-pr
 * changes who can *offer* a signal, never who is *believed* (ADR-0012).
 *
 * All GitHub access goes through an injectable `RunGh`, so the whole flow is
 * unit-tested without network or a real `gh` (ADR-0002: I/O at the edges).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { githubRepoForDid } from './resolve.js'
import { inboxSignalRelPath, renderInboxSignalFile, type SignedSignalEnvelope } from './signal.js'
import type { DeliveryReceipt, DeliveryTarget, SignalTransport } from './transport.js'

const execFileAsync = promisify(execFile)

export interface GhResult {
  readonly stdout: string
  readonly stderr: string
  /** 0 = success. 127 = `gh` not found. Any other non-zero = gh error. */
  readonly exitCode: number
}

/**
 * Runs the GitHub CLI. Injected so the transport is tested without network or
 * a real `gh`. MUST resolve (never reject) on a non-zero exit — the transport
 * inspects `exitCode` to decide between "degrade to undelivered" and "fatal".
 */
export type RunGh = (args: readonly string[]) => Promise<GhResult>

/** The real `gh` shell-out. Normalizes non-zero exit and ENOENT into GhResult. */
export const defaultRunGh: RunGh = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync('gh', [...args], {
      maxBuffer: 8 * 1024 * 1024,
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (err.code === 'ENOENT') {
      return { stdout: '', stderr: 'gh: command not found', exitCode: 127 }
    }
    const exitCode = typeof err.code === 'number' ? err.code : 1
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? err.message, exitCode }
  }
}

export interface GithubPrTransportDeps {
  readonly runGh?: RunGh
  /** Clock for the receipt timestamp; injectable for deterministic tests. */
  readonly now?: () => Date
}

/** Deterministic delivery branch for a (from, id) pair — the idempotency key. */
export function githubPrBranchName(fromDid: string, id: string): string {
  // ':' and any non-branch-safe char in the DID → '-'. id is already
  // constrained to [A-Za-z0-9_-] by buildSignedSignal.
  return `flyway/inbox/${fromDid.replace(/[^A-Za-z0-9._-]/g, '-')}/${id}`
}

function recordedOnly(now: () => Date, detail: string): DeliveryReceipt {
  return { transport: 'github-pr', delivered: false, at: now().toISOString(), detail }
}

function offered(now: () => Date, prUrl: string, detail: string): DeliveryReceipt {
  return { transport: 'github-pr', delivered: true, at: now().toISOString(), ref: prUrl, detail }
}

async function ghText(runGh: RunGh, args: readonly string[]): Promise<string | null> {
  const r = await runGh(args)
  return r.exitCode === 0 ? r.stdout : null
}

async function ghJson<T>(runGh: RunGh, args: readonly string[]): Promise<T | null> {
  const r = await runGh(args)
  if (r.exitCode !== 0) return null
  try {
    return JSON.parse(r.stdout) as T
  } catch {
    return null
  }
}

function prBody(envelope: SignedSignalEnvelope, relPath: string): string {
  return [
    `This pull request delivers a flyway signal into \`${relPath}\`.`,
    '',
    `- **kind:** ${envelope.kind}`,
    `- **id:** ${envelope.id}`,
    `- **from:** ${envelope.from}`,
    `- **to:** ${envelope.to}`,
    '',
    'Merging accepts delivery into your inbox. The signal is signed; verify it',
    'with `flyway check` (or the bundled `verify-signal` Action) before merging.',
    'The sender is *claimed*, not trusted, until your recognition of them',
    'verifies the signature over these exact bytes.',
  ].join('\n')
}

/**
 * Build a github-pr transport bound to a `RunGh` and clock. The default
 * export `githubPrTransport` uses the real `gh`; tests inject a fake.
 *
 * The gh call sequence:
 *   1. auth status         — present & authenticated? (else: recorded-only)
 *   2. api user            — the authenticated login (fork owner)
 *   3. api repos/O/R       — default branch + push permission
 *   4. repo fork           — only if no push access (fork-first, ADR-0012)
 *   5. api …/pulls?head=…  — idempotency: PR already offered? → no-op
 *   6. git/refs POST       — create the deterministic delivery branch
 *   7. contents PUT        — add the inbox file (exact canonical bytes)
 *   8. pulls POST          — open the PR; its html_url is the receipt ref
 */
export function createGithubPrTransport(deps: GithubPrTransportDeps = {}): SignalTransport {
  const runGh = deps.runGh ?? defaultRunGh
  const now = deps.now ?? ((): Date => new Date())

  return async (
    envelope: SignedSignalEnvelope,
    target: DeliveryTarget,
  ): Promise<DeliveryReceipt> => {
    const { owner, repo } = githubRepoForDid(target.toDid)
    const relPath = inboxSignalRelPath(envelope.from, envelope.id)
    const fileContent = renderInboxSignalFile(envelope)
    const branch = githubPrBranchName(envelope.from, envelope.id)

    // 1. Preflight — degrade cleanly; the outbox record already stands.
    const auth = await runGh(['auth', 'status'])
    if (auth.exitCode !== 0) {
      return recordedOnly(
        now,
        auth.exitCode === 127
          ? 'GitHub CLI (gh) not found — install it and run `gh auth login`, then re-send.'
          : 'GitHub CLI not authenticated — run `gh auth login`, then re-send. Signal is recorded in the outbox.',
      )
    }

    // 2. Who are we, and 3. can we push to the recipient repo?
    const login = (await ghText(runGh, ['api', 'user', '--jq', '.login']))?.trim()
    if (!login) {
      return recordedOnly(
        now,
        'Could not determine the authenticated GitHub user. Check `gh auth status`, then re-send.',
      )
    }
    const repoJson = await ghJson<{ default_branch?: string; permissions?: { push?: boolean } }>(
      runGh,
      ['api', `repos/${owner}/${repo}`],
    )
    if (!repoJson) {
      return recordedOnly(
        now,
        `Recipient repo ${owner}/${repo} is not reachable. Confirm the did:web resolves to a real repo, then re-send.`,
      )
    }
    const baseBranch = repoJson.default_branch ?? 'main'
    const canPush = repoJson.permissions?.push === true

    // 4. Fork-first: without push access, deliver from the sender's fork.
    const headOwner = canPush ? owner : login
    if (!canPush) {
      const fork = await runGh(['repo', 'fork', `${owner}/${repo}`, '--clone=false'])
      if (fork.exitCode !== 0) {
        return recordedOnly(
          now,
          `Could not fork ${owner}/${repo} to deliver from (${fork.stderr.trim()}). Signal is recorded in the outbox.`,
        )
      }
    }

    // 5. Idempotency — a PR for this (from, id) branch already offered?
    const existing = await ghJson<Array<{ html_url?: string }>>(runGh, [
      'api',
      `repos/${owner}/${repo}/pulls`,
      '-f',
      `head=${headOwner}:${branch}`,
      '-f',
      'state=all',
    ])
    const existingPr = existing?.[0]?.html_url
    if (existingPr) {
      return offered(
        now,
        existingPr,
        'signal already offered for this (from, id) — idempotent no-op',
      )
    }

    // 6. Create the delivery branch on the head repo from the recipient's base.
    const baseSha = (
      await ghText(runGh, [
        'api',
        `repos/${headOwner}/${repo}/git/ref/heads/${baseBranch}`,
        '--jq',
        '.object.sha',
      ])
    )?.trim()
    if (!baseSha) {
      return recordedOnly(
        now,
        `Could not read ${headOwner}/${repo}@${baseBranch} to branch from. Re-send once the fork is ready.`,
      )
    }
    const mkRef = await runGh([
      'api',
      '-X',
      'POST',
      `repos/${headOwner}/${repo}/git/refs`,
      '-f',
      `ref=refs/heads/${branch}`,
      '-f',
      `sha=${baseSha}`,
    ])
    // 422 "Reference already exists" = a prior partial send; reuse the branch.
    if (mkRef.exitCode !== 0 && !/already exists/i.test(mkRef.stderr)) {
      return recordedOnly(
        now,
        `Could not create delivery branch ${branch} (${mkRef.stderr.trim()}).`,
      )
    }

    // 7. Add the inbox file — the exact canonical bytes, base64 for the API.
    const put = await runGh([
      'api',
      '-X',
      'PUT',
      `repos/${headOwner}/${repo}/contents/${relPath}`,
      '-f',
      `message=flyway: deliver ${envelope.kind} signal ${envelope.id}`,
      '-f',
      `content=${Buffer.from(fileContent, 'utf8').toString('base64')}`,
      '-f',
      `branch=${branch}`,
    ])
    // A prior partial send may have already committed the identical file.
    if (put.exitCode !== 0 && !/already exists|sha.+(supplied|required)/i.test(put.stderr)) {
      return recordedOnly(now, `Could not add the signal file to ${branch} (${put.stderr.trim()}).`)
    }

    // 8. Open the PR against the recipient repo. PR-open = delivered (ADR-0012).
    const pr = await ghJson<{ html_url?: string }>(runGh, [
      'api',
      '-X',
      'POST',
      `repos/${owner}/${repo}/pulls`,
      '-f',
      `title=flyway signal: ${envelope.kind} from ${envelope.from}`,
      '-f',
      `head=${headOwner}:${branch}`,
      '-f',
      `base=${baseBranch}`,
      '-f',
      `body=${prBody(envelope, relPath)}`,
    ])
    if (!pr?.html_url) {
      return recordedOnly(
        now,
        `Branch and file are pushed, but opening the PR failed. Re-send to retry (idempotent), or open a PR from ${headOwner}:${branch} manually.`,
      )
    }
    return offered(
      now,
      pr.html_url,
      'pull request opened — recipient merges to accept (PR-open = delivered)',
    )
  }
}

/** The github-pr transport wired to the real `gh` CLI. */
export const githubPrTransport: SignalTransport = createGithubPrTransport()

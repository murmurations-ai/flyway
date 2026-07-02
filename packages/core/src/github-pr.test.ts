import { describe, expect, it } from 'vitest'
import { flywayInit } from './init.js'
import {
  type GhResult,
  type RunGh,
  createGithubPrTransport,
  githubPrBranchName,
} from './github-pr.js'
import {
  type SignedSignalEnvelope,
  buildSignedSignal,
  inboxSignalRelPath,
  renderInboxSignalFile,
} from './signal.js'
import { localEd25519Signer } from './signing.js'

async function makeMurmuration(owner: string, name: string) {
  const artifacts = await flywayInit({
    repoUrl: `https://github.com/${owner}/${name}`,
    sourceName: owner,
    mode: 'interactive',
  })
  const signer = localEd25519Signer({
    privateKeyPem: artifacts.keypair.privateKeyPem,
    publicKeyJwk: artifacts.keypair.publicKeyJwk,
    verificationKeyId: `${artifacts.did}#key-1`,
  })
  return { did: artifacts.did, signer }
}

async function makeSignal(
  fromDid: string,
  toDid: string,
  signer: Parameters<typeof buildSignedSignal>[0]['signer'],
): Promise<SignedSignalEnvelope> {
  return buildSignedSignal({
    from: fromDid,
    to: toDid,
    kind: 'tension',
    body: { conditions: 'X', effect: 'Y' },
    signer,
    id: 'sig-001',
    now: new Date('2026-06-26T12:00:00.000Z'),
  })
}

// A fake `gh` that dispatches on the argv the transport builds, records every
// call, and returns canned responses. No network, no real gh.
interface FakeGhConfig {
  ghMissing?: boolean
  authFail?: boolean
  login?: string
  repoUnreachable?: boolean
  canPush?: boolean
  forkFail?: boolean
  existingPrUrl?: string
  prUrl?: string
}

function makeFakeGh(cfg: FakeGhConfig): { run: RunGh; calls: string[][] } {
  const calls: string[][] = []
  const ok = (stdout = ''): GhResult => ({ stdout, stderr: '', exitCode: 0 })
  const fail = (stderr: string, exitCode = 1): GhResult => ({ stdout: '', stderr, exitCode })

  const run: RunGh = (args) => {
    const a = [...args]
    calls.push(a)
    const has = (s: string): boolean => a.includes(s)
    const resource = a.find((t) => t === 'user' || t.startsWith('repos/')) ?? ''

    if (a[0] === 'auth' && a[1] === 'status') {
      if (cfg.ghMissing) return Promise.resolve(fail('gh: command not found', 127))
      if (cfg.authFail) return Promise.resolve(fail('not logged in', 1))
      return Promise.resolve(ok())
    }
    if (a[0] === 'repo' && a[1] === 'fork') {
      return Promise.resolve(cfg.forkFail ? fail('fork blocked') : ok())
    }
    if (resource === 'user') return Promise.resolve(ok(cfg.login ?? 'xeeban'))
    if (resource.endsWith('/pulls') && has('-X') && has('POST')) {
      return Promise.resolve(
        ok(JSON.stringify({ html_url: cfg.prUrl ?? 'https://github.com/emergent/praxis/pull/7' })),
      )
    }
    if (resource.endsWith('/pulls')) {
      return Promise.resolve(
        ok(JSON.stringify(cfg.existingPrUrl ? [{ html_url: cfg.existingPrUrl }] : [])),
      )
    }
    if (resource.includes('/git/ref/heads/')) return Promise.resolve(ok('basesha123'))
    if (resource.includes('/git/refs')) return Promise.resolve(ok(JSON.stringify({ ref: 'ok' })))
    if (resource.includes('/contents/'))
      return Promise.resolve(ok(JSON.stringify({ commit: { sha: 'c1' } })))
    // Bare repo info: repos/<owner>/<repo> with no sub-resource.
    if (resource.startsWith('repos/') && a.length === 2) {
      if (cfg.repoUnreachable) return Promise.resolve(fail('Not Found', 1))
      return Promise.resolve(
        ok(JSON.stringify({ default_branch: 'main', permissions: { push: cfg.canPush ?? false } })),
      )
    }
    return Promise.resolve(fail(`unexpected gh call: ${a.join(' ')}`))
  }
  return { run, calls }
}

const fixedNow = (): Date => new Date('2026-07-02T00:00:00.000Z')

/** Find the recorded gh call matching `pred`, or fail the test if there is none. */
function requireCall(calls: string[][], pred: (c: string[]) => boolean): string[] {
  const found = calls.find(pred)
  if (!found) throw new Error('expected a matching gh call, found none')
  return found
}

const isPrCreate = (c: string[]): boolean =>
  c.includes('POST') && c.some((t) => t.endsWith('/pulls'))

describe('githubPrBranchName', () => {
  it('is deterministic and sanitizes the DID colons', () => {
    expect(githubPrBranchName('did:web:github.com:xeeban:a', 'sig-001')).toBe(
      'flyway/inbox/did-web-github.com-xeeban-a/sig-001',
    )
  })
})

describe('createGithubPrTransport — happy path (fork-first, no push access)', () => {
  it('opens a cross-repo PR and reports PR-open as delivered', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run, calls } = makeFakeGh({ login: 'xeeban', canPush: false })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })

    expect(receipt.transport).toBe('github-pr')
    expect(receipt.delivered).toBe(true)
    expect(receipt.ref).toBe('https://github.com/emergent/praxis/pull/7')
    expect(receipt.at).toBe('2026-07-02T00:00:00.000Z')

    // Forked (no push access), and the PR head is the sender's fork.
    expect(calls.some((c) => c[0] === 'repo' && c[1] === 'fork')).toBe(true)
    const prCall = requireCall(calls, isPrCreate)
    const branch = githubPrBranchName(A.did, 'sig-001')
    expect(prCall).toContain(`head=xeeban:${branch}`)
    expect(prCall).toContain('base=main')
  })

  it('moves the envelope bytes verbatim (base64 of the exact inbox file)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run, calls } = makeFakeGh({ canPush: false })

    await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, { toDid: B.did })

    const putCall = requireCall(calls, (c) => c.includes('PUT'))
    const relPath = inboxSignalRelPath(A.did, 'sig-001')
    expect(putCall.some((t) => t.endsWith(`/contents/${relPath}`))).toBe(true)
    const contentArg = putCall.find((t) => t.startsWith('content='))
    expect(contentArg).toBeDefined()
    const decoded = Buffer.from((contentArg ?? '').slice('content='.length), 'base64').toString(
      'utf8',
    )
    expect(decoded).toBe(renderInboxSignalFile(signal))
  })
})

describe('createGithubPrTransport — direct branch (push access)', () => {
  it('does not fork and opens the PR from the recipient repo owner', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run, calls } = makeFakeGh({ canPush: true })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })

    expect(receipt.delivered).toBe(true)
    expect(calls.some((c) => c[0] === 'repo' && c[1] === 'fork')).toBe(false)
    const branch = githubPrBranchName(A.did, 'sig-001')
    const prCall = requireCall(calls, isPrCreate)
    expect(prCall).toContain(`head=emergent:${branch}`)
  })
})

describe('createGithubPrTransport — idempotency (ADR-0012 §7)', () => {
  it('returns the existing PR and makes no branch/file/PR-create calls', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run, calls } = makeFakeGh({
      canPush: false,
      existingPrUrl: 'https://github.com/emergent/praxis/pull/3',
    })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })

    expect(receipt.delivered).toBe(true)
    expect(receipt.ref).toBe('https://github.com/emergent/praxis/pull/3')
    expect(receipt.detail).toMatch(/idempotent/)
    // No mutating calls past the PR-exists probe.
    expect(calls.some((c) => c.includes('/git/refs'))).toBe(false)
    expect(calls.some((c) => c.includes('PUT'))).toBe(false)
    expect(calls.some((c) => c.includes('POST') && c.some((t) => t.endsWith('/pulls')))).toBe(false)
  })
})

describe('createGithubPrTransport — clean degradation (outbox already stands)', () => {
  it('records-only when gh is not installed', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run } = makeFakeGh({ ghMissing: true })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })
    expect(receipt.delivered).toBe(false)
    expect(receipt.detail).toMatch(/not found/i)
  })

  it('records-only when gh is unauthenticated', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run } = makeFakeGh({ authFail: true })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })
    expect(receipt.delivered).toBe(false)
    expect(receipt.detail).toMatch(/authenticated/i)
  })

  it('records-only when the recipient repo is unreachable', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run } = makeFakeGh({ repoUnreachable: true })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })
    expect(receipt.delivered).toBe(false)
    expect(receipt.detail).toMatch(/not reachable/i)
  })

  it('records-only when the fork cannot be created', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run } = makeFakeGh({ canPush: false, forkFail: true })

    const receipt = await createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
      toDid: B.did,
    })
    expect(receipt.delivered).toBe(false)
    expect(receipt.detail).toMatch(/fork/i)
  })
})

describe('createGithubPrTransport — rejects a non-github did', () => {
  it('throws for a non-github:com host (ADR-0011 boundary)', async () => {
    const A = await makeMurmuration('xeeban', 'a')
    const B = await makeMurmuration('emergent', 'praxis')
    const signal = await makeSignal(A.did, B.did, A.signer)
    const { run } = makeFakeGh({})
    await expect(
      createGithubPrTransport({ runGh: run, now: fixedNow })(signal, {
        toDid: 'did:web:example.com:someone',
      }),
    ).rejects.toThrow(/github\.com/i)
  })
})

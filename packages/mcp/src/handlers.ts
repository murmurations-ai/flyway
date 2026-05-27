import {
  type DidDocument,
  FLYWAY_TOOLS,
  type FlywayMode,
  PROPOSAL_DECISIONS,
  PROPOSAL_TYPES,
  type ProposalAntecedent,
  type ProposalBody,
  type ProposalDecision,
  type ProposalResponseBody,
  type ProposalResponseRefs,
  type ProposalStage,
  type ProposalType,
  type SignalRefs,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  TENSION_DECISIONS,
  type TensionBody,
  type TensionDecision,
  type TensionResponseBody,
  type TensionResponseRefs,
  createProposal,
  createProposalResponse,
  createTension,
  createTensionResponse,
  flywayCheck,
  flywayInit,
  flywayStatus,
  localEd25519Signer,
  recognizePeer,
} from '@murmurations-ai/flyway-core'
import type {
  CallToolRequest,
  CallToolResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'

const NOT_IMPLEMENTED_NOTICE =
  'flyway is in design phase; this tool is not yet implemented. ' +
  'See https://github.com/murmurations-ai/flyway for status.'

export function listFlywayTools(): ListToolsResult {
  return {
    tools: FLYWAY_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> & { type: 'object' },
    })),
  }
}

export async function callFlywayTool(request: CallToolRequest): Promise<CallToolResult> {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'flyway_init':
      return handleInit(args)
    case 'flyway_status':
      return handleStatus(args)
    case 'flyway_recognize':
      return handleRecognize(args)
    case 'flyway_check':
      return handleCheck(args)
    case 'flyway_tension':
      return handleTension(args)
    case 'flyway_respond':
      return handleRespond(args)
    case 'flyway_propose':
      return handleProposal(args)
    default:
      return notImplemented(name)
  }
}

async function handleProposal(
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  // Stateless: caller supplies own identity + (optionally) antecedents
  // for tension promotion / stage chain continuation. Handler delegates
  // to createProposal which enforces ADR-0009 antecedent verification.
  if (!args || typeof args !== 'object') {
    return errorResult(
      'flyway_propose requires arguments: ownDidDocument, ownPrivateKeyPem, peerDid, body',
    )
  }
  const a = args as Record<string, unknown>
  if (
    typeof a.ownPrivateKeyPem !== 'string' ||
    typeof a.ownDidDocument !== 'object' ||
    a.ownDidDocument === null ||
    typeof a.peerDid !== 'string' ||
    typeof a.body !== 'object' ||
    a.body === null
  ) {
    return errorResult(
      'flyway_propose requires: ownDidDocument (object), ownPrivateKeyPem (string), peerDid (string), body (object)',
    )
  }
  const ownDidDocument = a.ownDidDocument as DidDocument
  const ownVerificationMethod = ownDidDocument.verificationMethod?.[0]
  if (!ownVerificationMethod) {
    return errorResult('flyway_propose: ownDidDocument has no verificationMethod')
  }
  const proposalBody = a.body as ProposalBody
  if (
    typeof proposalBody.type !== 'string' ||
    !(PROPOSAL_TYPES as readonly string[]).includes(proposalBody.type)
  ) {
    return errorResult(
      `flyway_propose: body.type must be one of ${PROPOSAL_TYPES.join(', ')}`,
    )
  }
  const tensionAntecedent = extractAntecedent(a.tensionAntecedent)
  const proposalAntecedent = extractAntecedent(a.proposalAntecedent)
  if (tensionAntecedent === 'invalid' || proposalAntecedent === 'invalid') {
    return errorResult(
      'flyway_propose: when present, tensionAntecedent and proposalAntecedent must each be ' +
        '{ envelope: SignedSignalEnvelope, senderDidDocument: DidDocument }',
    )
  }
  try {
    const signer = localEd25519Signer({
      privateKeyPem: a.ownPrivateKeyPem,
      publicKeyJwk: ownVerificationMethod.publicKeyJwk,
      verificationKeyId: ownVerificationMethod.id,
    })
    const envelope = await createProposal({
      from: ownDidDocument.id,
      to: a.peerDid,
      body: proposalBody,
      signer,
      ...(tensionAntecedent ? { tensionAntecedent } : {}),
      ...(proposalAntecedent ? { proposalAntecedent } : {}),
    })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              envelope,
              note:
                'Write this proposal to flyway/outbox/<peer-segments>/<id>.yaml ' +
                'in your repo and deliver to ' +
                'flyway/inbox/<your-segments>/<id>.yaml in the peer’s repo. The ' +
                'flyway CLI `propose` subcommand does both.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_propose failed: ${(e as Error).message}`)
  }
}

/**
 * Best-effort extraction of an antecedent from MCP arguments. Returns
 * undefined if absent, 'invalid' if present but malformed, or the
 * structured antecedent otherwise.
 */
function extractAntecedent(
  raw: unknown,
): ProposalAntecedent | undefined | 'invalid' {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return 'invalid'
  const r = raw as Record<string, unknown>
  if (
    typeof r.envelope !== 'object' ||
    r.envelope === null ||
    typeof r.senderDidDocument !== 'object' ||
    r.senderDidDocument === null
  ) {
    return 'invalid'
  }
  return {
    envelope: r.envelope as SignedSignalEnvelope,
    senderDidDocument: r.senderDidDocument as DidDocument,
  }
}

/**
 * flyway_respond is a kind-dispatcher: the subject envelope's `kind`
 * determines which response builder runs. v0.1 wires only the
 * tension branch; the proposal branch returns an informative error
 * until `flyway_propose` lands. Keeping the dispatch shape here means
 * adding the proposal branch later is mechanical — no rewriting of
 * existing logic.
 */
async function handleRespond(
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  if (!args || typeof args !== 'object') {
    return errorResult(
      'flyway_respond requires arguments: ownDidDocument, ownPrivateKeyPem, ' +
        'peerDidDocument, subjectEnvelope, decision',
    )
  }
  const a = args as Record<string, unknown>
  if (
    typeof a.ownPrivateKeyPem !== 'string' ||
    typeof a.ownDidDocument !== 'object' ||
    a.ownDidDocument === null ||
    typeof a.peerDidDocument !== 'object' ||
    a.peerDidDocument === null ||
    typeof a.subjectEnvelope !== 'object' ||
    a.subjectEnvelope === null ||
    typeof a.decision !== 'string'
  ) {
    return errorResult(
      'flyway_respond requires: ownDidDocument (object), ownPrivateKeyPem (string), ' +
        'peerDidDocument (object), subjectEnvelope (object), decision (string)',
    )
  }
  // Minimal shape check on subjectEnvelope — verifySignedSignal would
  // throw a confusing error if these are missing.
  const rawSubject = a.subjectEnvelope as Record<string, unknown>
  if (
    typeof rawSubject.id !== 'string' ||
    typeof rawSubject.from !== 'string' ||
    typeof rawSubject.kind !== 'string' ||
    typeof rawSubject.signature !== 'object'
  ) {
    return errorResult(
      'flyway_respond: subjectEnvelope is missing required fields (id, from, kind, signature)',
    )
  }
  // Dispatch on subject kind.
  switch (rawSubject.kind) {
    case 'tension':
      return handleTensionResponse(a)
    case 'proposal':
      return handleProposalResponse(a)
    default:
      return errorResult(
        `flyway_respond: cannot respond to subjectEnvelope.kind='${String(rawSubject.kind)}' ` +
          `(only 'tension' and 'proposal' are wired).`,
      )
  }
}

async function handleProposalResponse(
  a: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!PROPOSAL_DECISIONS.includes(a.decision as ProposalDecision)) {
    return errorResult(
      `flyway_respond: decision must be one of ${PROPOSAL_DECISIONS.join(', ')} ` +
        'when responding to a proposal',
    )
  }
  const ownDidDocument = a.ownDidDocument as DidDocument
  const peerDidDocument = a.peerDidDocument as DidDocument
  const subject = a.subjectEnvelope as SignedSignalEnvelope
  const ownVerificationMethod = ownDidDocument.verificationMethod?.[0]
  if (!ownVerificationMethod) {
    return errorResult('flyway_respond: ownDidDocument has no verificationMethod')
  }
  // Optional concernsToRecord array.
  let concernsToRecord: readonly string[] | undefined
  if (a.concernsToRecord !== undefined) {
    if (!Array.isArray(a.concernsToRecord)) {
      return errorResult('flyway_respond: concernsToRecord must be an array of strings when present')
    }
    concernsToRecord = a.concernsToRecord as readonly string[]
  }
  try {
    const body: ProposalResponseBody = {
      decision: a.decision as ProposalDecision,
      ...(typeof a.reason === 'string' ? { reason: a.reason } : {}),
      ...(concernsToRecord !== undefined ? { concernsToRecord } : {}),
    }
    const refs: ProposalResponseRefs = {
      proposalId: subject.id,
      inReplyTo: subject.id,
    }
    const signer = localEd25519Signer({
      privateKeyPem: a.ownPrivateKeyPem as string,
      publicKeyJwk: ownVerificationMethod.publicKeyJwk,
      verificationKeyId: ownVerificationMethod.id,
    })
    const envelope = await createProposalResponse({
      from: ownDidDocument.id,
      to: peerDidDocument.id,
      body,
      refs,
      subjectEnvelope: subject,
      subjectSenderDidDocument: peerDidDocument,
      signer,
    })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              envelope,
              note:
                'Write this proposal response to flyway/outbox/<peer-segments>/<id>.yaml ' +
                'in your repo and deliver to ' +
                'flyway/inbox/<your-segments>/<id>.yaml in the peer’s repo. The ' +
                'flyway CLI `respond` subcommand does both.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_respond failed: ${(e as Error).message}`)
  }
}

async function handleTensionResponse(
  a: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!TENSION_DECISIONS.includes(a.decision as TensionDecision)) {
    return errorResult(
      `flyway_respond: decision must be one of ${TENSION_DECISIONS.join(', ')} ` +
        'when responding to a tension (proposal decisions are not yet wired in v0.1)',
    )
  }
  const ownDidDocument = a.ownDidDocument as DidDocument
  const peerDidDocument = a.peerDidDocument as DidDocument
  const subject = a.subjectEnvelope as SignedSignalEnvelope
  const ownVerificationMethod = ownDidDocument.verificationMethod?.[0]
  if (!ownVerificationMethod) {
    return errorResult('flyway_respond: ownDidDocument has no verificationMethod')
  }
  try {
    const body: TensionResponseBody = {
      decision: a.decision as TensionDecision,
      ...(typeof a.reason === 'string' ? { reason: a.reason } : {}),
      ...(typeof a.transferTo === 'string' ? { transferTo: a.transferTo } : {}),
    }
    const refs: TensionResponseRefs = {
      tensionId: subject.id,
      inReplyTo: subject.id,
    }
    const signer = localEd25519Signer({
      privateKeyPem: a.ownPrivateKeyPem as string,
      publicKeyJwk: ownVerificationMethod.publicKeyJwk,
      verificationKeyId: ownVerificationMethod.id,
    })
    const envelope = await createTensionResponse({
      from: ownDidDocument.id,
      to: peerDidDocument.id,
      body,
      refs,
      subjectEnvelope: subject,
      subjectSenderDidDocument: peerDidDocument,
      signer,
    })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              envelope,
              note:
                'Write this response to flyway/outbox/<peer-segments>/<id>.yaml ' +
                'in your repo and deliver to ' +
                'flyway/inbox/<your-segments>/<id>.yaml in the peer’s repo. The ' +
                'flyway CLI `respond` subcommand does both.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_respond failed: ${(e as Error).message}`)
  }
}

async function handleTension(
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  // Stateless: the calling agent supplies its own identity and the peer
  // DID; the handler signs an envelope and returns it. The caller is
  // responsible for writing to its own outbox and delivering to the
  // peer's inbox — the flyway CLI's `tension` subcommand does this.
  if (!args || typeof args !== 'object') {
    return errorResult(
      'flyway_tension requires arguments: ownDidDocument, ownPrivateKeyPem, peerDid, conditions, effect',
    )
  }
  const a = args as Record<string, unknown>
  if (
    typeof a.ownPrivateKeyPem !== 'string' ||
    typeof a.ownDidDocument !== 'object' ||
    a.ownDidDocument === null ||
    typeof a.peerDid !== 'string' ||
    typeof a.conditions !== 'string' ||
    typeof a.effect !== 'string'
  ) {
    return errorResult(
      'flyway_tension requires: ownDidDocument (object), ownPrivateKeyPem (string), peerDid (string), conditions (string), effect (string)',
    )
  }
  const ownDidDocument = a.ownDidDocument as DidDocument
  const ownVerificationMethod = ownDidDocument.verificationMethod?.[0]
  if (!ownVerificationMethod) {
    return errorResult('flyway_tension: ownDidDocument has no verificationMethod')
  }
  const body: TensionBody = {
    conditions: a.conditions,
    effect: a.effect,
    ...(typeof a.relevance === 'string' ? { relevance: a.relevance } : {}),
    ...(typeof a.proposedOwner === 'string' ? { proposedOwner: a.proposedOwner } : {}),
  }
  const refs =
    a.refs && typeof a.refs === 'object' ? (a.refs as SignalRefs) : undefined
  try {
    const signer = localEd25519Signer({
      privateKeyPem: a.ownPrivateKeyPem,
      publicKeyJwk: ownVerificationMethod.publicKeyJwk,
      verificationKeyId: ownVerificationMethod.id,
    })
    const envelope = await createTension({
      from: ownDidDocument.id,
      to: a.peerDid,
      body,
      signer,
      ...(refs !== undefined ? { refs } : {}),
    })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              envelope,
              note:
                'Write this envelope to flyway/outbox/<peer-segments>/<id>.yaml ' +
                'in your repo and deliver it to the peer at ' +
                'flyway/inbox/<your-segments>/<id>.yaml in their repo. The flyway ' +
                'CLI `tension` subcommand does both.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_tension failed: ${(e as Error).message}`)
  }
}

async function handleCheck(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  const cwdArg = args && typeof args === 'object' ? (args as Record<string, unknown>).cwd : undefined
  const cwd = typeof cwdArg === 'string' ? cwdArg : process.cwd()
  try {
    const inbox = await flywayCheck(cwd)
    return {
      content: [{ type: 'text', text: JSON.stringify(inbox, null, 2) }],
    }
  } catch (e) {
    return errorResult(`flyway_check failed: ${(e as Error).message}`)
  }
}

async function handleRecognize(
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  // The MCP handler doesn't itself read or write the local repo. It expects
  // the calling agent to supply both the recognizing Source's identity and
  // the peer's identity as pre-fetched artifacts. Persistence (writing to
  // peers.yaml, caching peer artifacts) is the agent's responsibility — or
  // is delegated to the flyway CLI's `recognize` subcommand.
  if (!args || typeof args !== 'object') {
    return errorResult(
      'flyway_recognize requires arguments: ownDidDocument, ownPrivateKeyPem, peerDidDocument, peerEntityStatement',
    )
  }
  const a = args as Record<string, unknown>
  if (
    typeof a.ownPrivateKeyPem !== 'string' ||
    typeof a.ownDidDocument !== 'object' ||
    a.ownDidDocument === null ||
    typeof a.peerDidDocument !== 'object' ||
    a.peerDidDocument === null ||
    typeof a.peerEntityStatement !== 'object' ||
    a.peerEntityStatement === null
  ) {
    return errorResult(
      'flyway_recognize requires: ownDidDocument (object), ownPrivateKeyPem (string), peerDidDocument (object), peerEntityStatement (object)',
    )
  }
  const ownDidDocument = a.ownDidDocument as DidDocument
  const peerDidDocument = a.peerDidDocument as DidDocument
  const peerEntityStatement = a.peerEntityStatement as SignedEntityStatement
  const ownVerificationMethod = ownDidDocument.verificationMethod?.[0]
  if (!ownVerificationMethod) {
    return errorResult('flyway_recognize: ownDidDocument has no verificationMethod')
  }
  try {
    const signer = localEd25519Signer({
      privateKeyPem: a.ownPrivateKeyPem,
      publicKeyJwk: ownVerificationMethod.publicKeyJwk,
      verificationKeyId: ownVerificationMethod.id,
    })
    const { entry, peerSignatureValid } = await recognizePeer({
      peerDidDocument,
      peerEntityStatement,
      recognizedByDid: ownDidDocument.id,
      signer,
      ...(typeof a.note === 'string' ? { note: a.note } : {}),
    })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              peerDid: entry.did,
              peerSignatureValid,
              entry,
              note:
                'Append the entry to flyway/peers.yaml and cache ' +
                'peerDidDocument + peerEntityStatement under ' +
                'flyway/peers/<host>/<owner>/<repo>/ in your repo. The ' +
                'flyway CLI `recognize` subcommand does this for you.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_recognize failed: ${(e as Error).message}`)
  }
}

async function handleStatus(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  // flyway_status has no required arguments (empty inputSchema). An optional
  // cwd override is honoured if a caller wants to inspect a different repo
  // checkout; otherwise we use the MCP server's working directory.
  const cwdArg = args && typeof args === 'object' ? (args as Record<string, unknown>).cwd : undefined
  const cwd = typeof cwdArg === 'string' ? cwdArg : process.cwd()
  try {
    const status = await flywayStatus(cwd)
    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
    }
  } catch (e) {
    return errorResult(`flyway_status failed: ${(e as Error).message}`)
  }
}

function notImplemented(name: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${name}: ${NOT_IMPLEMENTED_NOTICE}` }],
    isError: true,
  }
}

async function handleInit(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  if (!args || typeof args !== 'object') {
    return errorResult('flyway_init requires arguments: repoUrl, sourceName, mode')
  }
  const { repoUrl, sourceName, mode } = args as Record<string, unknown>
  if (typeof repoUrl !== 'string' || typeof sourceName !== 'string' || typeof mode !== 'string') {
    return errorResult('flyway_init requires string repoUrl, sourceName, and mode')
  }
  try {
    const artifacts = await flywayInit({
      repoUrl,
      sourceName,
      mode: mode as FlywayMode,
    })
    // MCP-side flyway_init returns the artifacts; the calling agent is
    // responsible for writing them to its repo (or for invoking the CLI
    // which does write them). This keeps the MCP server stateless.
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              did: artifacts.did,
              didDocument: artifacts.didDocument,
              entityStatement: artifacts.entityStatement,
              keypair: {
                publicKeyJwk: artifacts.keypair.publicKeyJwk,
                privateKeyPem: artifacts.keypair.privateKeyPem,
              },
              note:
                'Persist these artifacts to .well-known/did.json, ' +
                'flyway/entity-statement.json, and flyway/keys/source.key in the ' +
                "Source's repo. Add flyway/keys/ to .gitignore. The private key " +
                'must not be committed.',
            },
            null,
            2,
          ),
        },
      ],
    }
  } catch (e) {
    return errorResult(`flyway_init failed: ${(e as Error).message}`)
  }
}

function errorResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  }
}

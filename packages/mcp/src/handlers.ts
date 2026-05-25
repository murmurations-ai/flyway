import {
  type DidDocument,
  FLYWAY_TOOLS,
  type FlywayMode,
  type SignalRefs,
  type SignedEntityStatement,
  type SignedSignalEnvelope,
  TENSION_DECISIONS,
  type TensionBody,
  type TensionDecision,
  type TensionResponseBody,
  type TensionResponseRefs,
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
    default:
      return notImplemented(name)
  }
}

async function handleRespond(
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  // Stateless: the calling agent supplies its own identity, the subject
  // envelope (as it received it), the peer's *recognition-time-cached*
  // DID document, and the decision. The handler delegates to
  // createTensionResponse which performs ADR-0009 antecedent
  // verification (kind + id + sender + signature) before signing.
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
  if (!TENSION_DECISIONS.includes(a.decision as TensionDecision)) {
    return errorResult(
      `flyway_respond: decision must be one of ${TENSION_DECISIONS.join(', ')} ` +
        '(proposal decisions are not yet wired in v0.1)',
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
  const ownDidDocument = a.ownDidDocument as DidDocument
  const peerDidDocument = a.peerDidDocument as DidDocument
  const subject = rawSubject as unknown as SignedSignalEnvelope
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
      privateKeyPem: a.ownPrivateKeyPem,
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

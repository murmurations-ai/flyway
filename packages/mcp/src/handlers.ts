import {
  type DidDocument,
  FLYWAY_TOOLS,
  type FlywayMode,
  type SignedEntityStatement,
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
    default:
      return notImplemented(name)
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

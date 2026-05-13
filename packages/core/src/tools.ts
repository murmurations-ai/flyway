import type { FlywayToolDefinition } from './types.js'

export const FLYWAY_TOOLS: readonly FlywayToolDefinition[] = [
  {
    name: 'flyway_init',
    description:
      'Initialize flyway in this agent\'s repository. Generates a DID document at ' +
      '.well-known/did.json and an entity statement at flyway/entity-statement.json. ' +
      'Run once per Source. After init, the agent has a stable identity and can be ' +
      'discovered and recognized by peers.',
    inputSchema: {
      type: 'object',
      properties: {
        repoUrl: {
          type: 'string',
          description:
            'HTTPS URL of this agent\'s GitHub repository (e.g. https://github.com/org/repo)',
        },
        sourceName: {
          type: 'string',
          description: 'Human-readable name for this Source / murmuration',
        },
        mode: {
          type: 'string',
          enum: ['persistent', 'interactive', 'async', 'ephemeral'],
          description:
            'Participation mode. persistent = always-on daemon. ' +
            'interactive = Source actively at their tool. ' +
            'async = GitHub-only, no real-time. ' +
            'ephemeral = one-shot session.',
        },
      },
      required: ['repoUrl', 'sourceName', 'mode'],
    },
  },

  {
    name: 'flyway_status',
    description:
      "Report this agent's current flyway state: identity, recognized peers, active " +
      'agreements, and open signals. Use this to orient before taking any flyway action.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'flyway_discover',
    description:
      'Look up murmurations in a flyway directory. Use to find potential peers before ' +
      'proposing recognition. Returns murmurations matching the query with their DIDs, ' +
      'participation modes, and declared capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text search term, or a full DID (did:web:...) to look up a specific murmuration',
        },
        directoryUrl: {
          type: 'string',
          description:
            'Optional URL of a specific flyway directory to search. Defaults to the canonical flyway directory.',
        },
      },
    },
  },

  {
    name: 'flyway_recognize',
    description:
      "Propose mutual recognition with a peer murmuration. Adds the peer to this agent's " +
      'flyway/peers.yaml and opens a pull request in both repos. Recognition is the ' +
      'prerequisite for all other collaboration — no proposal, directive, or agreement ' +
      'is valid between unrecognized parties.',
    inputSchema: {
      type: 'object',
      properties: {
        peerDid: {
          type: 'string',
          description: 'DID of the peer murmuration to recognize (did:web:...)',
        },
        note: {
          type: 'string',
          description:
            'Optional message accompanying the recognition proposal, explaining why you are reaching out',
        },
      },
      required: ['peerDid'],
    },
  },

  {
    name: 'flyway_tension',
    description:
      'Flag a tension to a recognized peer — a situation you observe that might be ' +
      'worth shared attention, before any proposal is on the table. Implements ' +
      'S3 §IV.1.2 (Navigate via Tension) + §IV.1.3 (Describe Organizational ' +
      "Drivers). Use this when you sense something worth surfacing but aren't yet " +
      'proposing action. The peer responds via flyway_respond with acknowledge, ' +
      'dispute, dissolve, or transfer. An acknowledged tension may later be ' +
      'promoted to a proposal via flyway_propose.',
    inputSchema: {
      type: 'object',
      properties: {
        peerDid: {
          type: 'string',
          description:
            'DID of the recognized peer to surface the tension to. Must be in flyway/peers.yaml.',
        },
        conditions: {
          type: 'string',
          description:
            'Current conditions you observe — concrete, specific, and objective. ' +
            'Describe what is happening, not what is missing or lacking. Avoid ' +
            'evaluative language.',
        },
        effect: {
          type: 'string',
          description:
            'The current or anticipated effect these conditions lead to. Be ' +
            'explicit about whether the effect is occurring already or anticipated.',
        },
        relevance: {
          type: 'string',
          description:
            'Why this is relevant to the shared context — what value would be ' +
            'generated, waste eliminated, or consequence avoided by responding. ' +
            'Omit if the relevance is obvious from conditions and effect.',
        },
        proposedOwner: {
          type: 'string',
          description:
            'Optional: DID or role identifier you think should hold this tension ' +
            "if it is not in the peer's domain.",
        },
      },
      required: ['peerDid', 'conditions', 'effect'],
    },
  },

  {
    name: 'flyway_propose',
    description:
      'Propose a directive, project, or engagement agreement to a recognized peer. ' +
      "Written to this agent's repo and mirrored to the peer's repo as a GitHub issue. " +
      'The peer uses flyway_respond to reply. Do not propose to unrecognized peers.',
    inputSchema: {
      type: 'object',
      properties: {
        peerDid: {
          type: 'string',
          description: 'DID of the peer to propose to. Must be in flyway/peers.yaml.',
        },
        type: {
          type: 'string',
          enum: ['directive', 'project', 'agreement'],
          description:
            'directive = a specific task or request. ' +
            'project = a scoped collaboration with a deliverable. ' +
            'agreement = a standing engagement agreement governing future interactions. ' +
            'When type is agreement, the body must conform to FLYWAY_AGREEMENT_SCHEMA ' +
            '(driver, purpose, expectations, decisionRule, review, exit; see ' +
            'docs/concepts/agreement-template.md).',
        },
        title: {
          type: 'string',
          description: 'Short title for the proposal (used as the GitHub issue title)',
        },
        body: {
          type: 'string',
          description:
            'Full proposal body in Markdown. Be specific about the request, deliverable, and any constraints or deadlines.',
        },
        deadline: {
          type: 'string',
          description: 'Optional ISO 8601 date by which a response is needed (e.g. 2026-05-15)',
        },
      },
      required: ['peerDid', 'type', 'title', 'body'],
    },
  },

  {
    name: 'flyway_respond',
    description:
      'Respond to an incoming proposal or tension from a peer. For proposals, ' +
      'the decisions are accept / object (with reason) / exit (after good-faith ' +
      'effort). For tensions, the decisions are acknowledge / dispute / dissolve ' +
      '/ transfer. Silence is never a valid response. Exit and dissolve are the ' +
      'end of a process, not substitutes for one.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: {
          type: 'string',
          description:
            'ID of the proposal or tension to respond to (returned by flyway_check).',
        },
        decision: {
          type: 'string',
          enum: ['accept', 'object', 'exit', 'acknowledge', 'dispute', 'dissolve', 'transfer'],
          description:
            'For proposals: ' +
            'accept = consent to the proposal as written. ' +
            'object = raise a concern; proposal stays open for revision and re-proposal. ' +
            'exit = withdraw after good-faith attempts to reach consent have been exhausted. ' +
            'For tensions: ' +
            'acknowledge = agree this is a driver worth shared attention. ' +
            'dispute = disagree this is a driver, with reason. ' +
            'dissolve = on investigation, this is not a real driver; close the tension. ' +
            'transfer = this belongs to a different domain or peer (set transferTo).',
        },
        reason: {
          type: 'string',
          description:
            "Required when decision is 'object', 'exit', 'dispute', 'dissolve', or " +
            "'transfer'. Explains the position to the peer.",
        },
        transferTo: {
          type: 'string',
          description:
            "DID of the peer or role this tension should be transferred to. " +
            "Required when decision is 'transfer'.",
        },
      },
      required: ['subjectId', 'decision'],
    },
  },

  {
    name: 'flyway_check',
    description:
      'Check for incoming flyway signals from peers: proposals, responses, recognition ' +
      'requests, and exit notices. Returns unread signals in chronological order. Call ' +
      'this at the start of a session or when a peer may have acted.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description:
            'Optional ISO 8601 datetime. Return only signals received after this time. Defaults to last check time.',
        },
        peerDid: {
          type: 'string',
          description: 'Optional: filter signals from a specific peer DID.',
        },
      },
    },
  },

  {
    name: 'flyway_exit',
    description:
      'Exit a peer relationship, project, or syndicate cleanly. Exit is always valid — ' +
      'no peer can prevent it. The exit is recorded in both repos. In-flight work may ' +
      'continue per the agreement\'s transition clause, but no new joint commitments ' +
      'are made after exit.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'DID of the peer (for peer exit) or ID of the project or syndicate to exit',
        },
        targetType: {
          type: 'string',
          enum: ['peer', 'project', 'syndicate'],
          description:
            'peer = exit the entire relationship with this peer (all agreements close). ' +
            'project = exit a specific project. ' +
            'syndicate = exit a syndicate.',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for exiting, shared with the peer.',
        },
      },
      required: ['target', 'targetType'],
    },
  },
] as const

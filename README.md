# SecureLore

SecureLore is a Slack-native preflight review system for teams building Slack agents, MCP integrations, and Marketplace-ready apps.

The business problem is the approval gap between a fast-moving builder and the workspace admin who must decide whether a Slack app is safe to install. Builders often have a manifest, a few scopes, an MCP tools list, and a demo. Admins need something different: clear risk, scope justification, data handling, AI disclosure, and evidence that the app behaves as claimed. SecureLore turns that gap into a structured Slack workflow.

## What SecureLore Does

SecureLore reviews real Slack app and MCP artifacts, then creates an admin-ready packet:

- Slack Agent/Assistant experience with native onboarding and thread status
- zero-copy Workspace Evidence Scout using Slack Real-Time Search
- official Slack manifests plus separate structured review context
- SHA-256 artifact fingerprints and stale-approval detection
- risk grade with blockers and warnings
- OAuth scope justification table
- MCP tool safety review
- Marketplace-style checklist
- safer manifest patch plan
- admin approval brief
- Review Room with finding-specific evidence quality scoring and regrading
- corrected-artifact lineage with resolved, remaining, and new findings
- auditable human decisions that cannot approve unresolved blockers
- reviewer allowlist and workspace admin approval queue without `admin.*` scopes
- workspace policy overlays and runtime verification evidence
- self-service deletion from Slack App Home
- tenant-scoped retrieval learning and candidate regression evals

The product is intentionally Slack-native. Builders run `/securelore review`, paste or upload artifacts, search live workspace precedent, add evidence in Slack, promote sanitized lessons, and reopen reviews from App Home.

Workspace Evidence Scout is user-triggered and searches public-channel messages through Slack's `assistant.search.context` method. It uses the event's short-lived `action_token`, returns cited Slack permalinks, and does not persist, embed, train on, or automatically accept RTS results as review evidence.

SecureLore never adds custom properties to a Slack manifest. Feature declarations, public pages, AI disclosures, scope mappings, consequential actions, human controls, and runtime proof are collected as a separate review context. A canonical SHA-256 fingerprint binds every decision to the exact manifest, MCP tool list, and review context that was evaluated.

## Why It Matters

Slack agents can request sensitive scopes, expose AI behavior, connect MCP tools, and act inside workspaces. A generic chatbot answer is not enough for that workflow. SecureLore gives teams a repeatable review process that captures evidence, explains policy concerns, and improves over time without training a model on Slack data.

SecureLore learns through retrieval memory:

```mermaid
flowchart LR
  Evidence[Finding-specific evidence] --> Evaluate[Score and regrade]
  Evaluate --> Decision[Human review decision]
  Evidence --> Sanitize[Explicit sanitized lesson]
  Sanitize --> Embed[Cohere embedding]
  Embed --> Neon[(Neon pgvector memory)]
  Neon --> Retrieve[Future review retrieval]
  Retrieve --> Packet[Grounded future review]
  Feedback[False alarm or missed issue] --> Eval[Candidate regression eval]
  Evidence -. not used for model training .-> NoTraining[No LLM training]
```

## Architecture

```mermaid
flowchart LR
  Slack[Slack Agent UI, command, App Home] --> Vercel[Vercel HTTPS endpoints]
  Vercel --> Bolt[Bolt app]
  Bolt --> Core[review-core checks]
  Bolt --> Memory[Neon + Cohere retrieval]
  Bolt --> LLM[OpenRouter enrichment]
  Bolt --> RTS[Slack Real-Time Search]
  Core --> Packet[Review packet]
  Memory --> Packet
  LLM --> Packet
  RTS --> Live[Zero-copy cited precedent]
  Packet --> SlackUI[Block Kit UI]
  Packet --> Fingerprint[Version-bound approval fingerprint]
  SlackUI --> Slack
```

Detailed diagrams are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Technical Stack

- Slack Bolt for commands, events, modals, App Home, and Block Kit actions
- Slack Agent/Assistant UI for the native AI agent experience required by the challenge
- Slack Real-Time Search API for user-triggered, zero-copy public-channel precedent discovery
- Vercel for production HTTPS endpoints
- Next.js for public landing, privacy, and status pages
- TypeScript workspaces for Slack app, review core, memory, UI, and agent enrichment
- Neon Postgres with pgvector for review history, evidence, policies, and learning examples
- Cohere embeddings for policy and lesson retrieval
- OpenRouter for LLM-assisted review enrichment
- Executable regression benchmark for blocker recall, false positives, evidence guardrails, remediation, and human decisions
- Configured reviewer allowlist and approval channel for a fail-closed builder-to-admin handoff

## Public Pages

SecureLore includes public pages required for a production-style Slack app review:

- `/` landing page
- `/privacy` privacy and AI/data disclosure
- `/status` human-readable service status
- `/api/health` deployment health check

## Slack Workflow

```mermaid
sequenceDiagram
  participant B as Builder
  participant S as Slack
  participant A as SecureLore
  participant M as Memory
  participant R as Slack RTS

  B->>S: Start in Agent UI or /securelore review
  S->>A: Submit manifest and MCP tools/list JSON
  A->>M: Retrieve policy and learned lessons
  A->>S: Post review packet and Review Room
  B->>S: Ask for workspace precedent
  S->>R: assistant.search.context + action_token
  R-->>S: Cited public-channel results, not stored
  B->>S: Add evidence to a finding
  A->>A: Score evidence and regrade eligible finding
  A->>M: Store review evidence and updated packet
  A->>S: Repost Review Room with rationale and quality
  B->>S: Submit corrected artifacts
  A->>S: Show before/after grade and finding diff
  B->>S: Record human decision
  B->>S: Request configured admin review
  A->>S: Post fingerprinted packet to approval queue
  B->>S: Promote sanitized lesson
  A->>M: Store embedded learning example
```

## Local Development

Use Node 24.

```bash
npm install
npm run build
npm run smoke:slack-form
npm run smoke:slack-artifacts
npm run smoke:slack-home
npm run smoke:slack-rts
npm run eval:regression
```

Configure `SLACK_REVIEWER_IDS` with comma-separated Slack user IDs and `SLACK_APPROVAL_CHANNEL_ID` with the channel that receives approval requests. Optional `SECURELORE_WORKSPACE_POLICY_JSON` can block scopes, require reviewer attention, and require runtime proof without requesting Slack admin scopes.

## Production Endpoints

Production endpoints are deployed on Vercel:

- `/api/slack/commands`
- `/api/slack/events`
- `/api/slack/actions`
- `/api/health`

## Hackathon Track

Primary track: **New Slack Agent**.

SecureLore fits the challenge by building a Slack-native agent workflow that automates app review, surfaces policy-grounded insights, connects external memory and model systems, and creates artifacts that help teams make safer install decisions.

SecureLore uses two hackathon technologies: the Slack Agent experience and the Real-Time Search API. Agent View is the conversational review surface, while RTS is load-bearing for live workspace precedent discovery that respects the searching user's Slack access and keeps retrieved content zero-copy.

## Quality Evidence

`npm run eval:regression` runs a controlled benchmark covering blocker recall, a corrected low-risk sample, MCP metadata, sensitive-scope evidence, evidence-resolution guardrails, review lineage, artifact fingerprints, stale approvals, consequential actions, runtime proof, and workspace policy enforcement. These figures describe repository fixtures, not general-world accuracy.

## License

SecureLore is released under the [MIT License](LICENSE).

# SecureLore

SecureLore is a Slack-native preflight review system for teams building Slack agents, MCP integrations, and Marketplace-ready apps.

The business problem is the approval gap between a fast-moving builder and the workspace admin who must decide whether a Slack app is safe to install. Builders often have a manifest, a few scopes, an MCP tools list, and a demo. Admins need something different: clear risk, scope justification, data handling, AI disclosure, and evidence that the app behaves as claimed. SecureLore turns that gap into a structured Slack workflow.

## What SecureLore Does

SecureLore reviews real Slack app and MCP artifacts, then creates an admin-ready packet:

- risk grade with blockers and warnings
- OAuth scope justification table
- MCP tool safety review
- Marketplace-style checklist
- safer manifest patch plan
- admin approval brief
- Review Room for evidence capture
- retrieval learning trace for promoted lessons

The product is intentionally Slack-native. Builders run `/securelore review`, paste or upload artifacts, add evidence in Slack, promote sanitized lessons, and reopen reviews from App Home.

## Why It Matters

Slack agents can request sensitive scopes, expose AI behavior, connect MCP tools, and act inside workspaces. A generic chatbot answer is not enough for that workflow. SecureLore gives teams a repeatable review process that captures evidence, explains policy concerns, and improves over time without training a model on Slack data.

SecureLore learns through retrieval memory:

```mermaid
flowchart LR
  Evidence[Evidence and feedback] --> Sanitize[Sanitized promoted lesson]
  Sanitize --> Embed[Cohere embedding]
  Embed --> Neon[(Neon pgvector memory)]
  Neon --> Retrieve[Future review retrieval]
  Retrieve --> Packet[Better review packet]
  Evidence -. not used for model training .-> NoTraining[No LLM training]
```

## Architecture

```mermaid
flowchart LR
  Slack[Slack workspace] --> Vercel[Vercel HTTPS endpoints]
  Vercel --> Bolt[Bolt app]
  Bolt --> Core[review-core checks]
  Bolt --> Memory[Neon + Cohere retrieval]
  Bolt --> LLM[OpenRouter enrichment]
  Core --> Packet[Review packet]
  Memory --> Packet
  LLM --> Packet
  Packet --> SlackUI[Block Kit UI]
  SlackUI --> Slack
```

Detailed diagrams are in [docs/architecture.md](docs/architecture.md).

## Technical Stack

- Slack Bolt for commands, events, modals, App Home, and Block Kit actions
- Vercel for production HTTPS endpoints
- Next.js for public landing, privacy, and status pages
- TypeScript workspaces for Slack app, review core, memory, UI, and agent enrichment
- Neon Postgres with pgvector for review history, evidence, policies, and learning examples
- Cohere embeddings for policy and lesson retrieval
- OpenRouter for LLM-assisted review enrichment

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

  B->>S: /securelore review
  S->>A: Submit manifest and MCP tools/list JSON
  A->>M: Retrieve policy and learned lessons
  A->>S: Post review packet and Review Room
  B->>S: Add evidence to a finding
  A->>M: Store review evidence
  A->>S: Repost Review Room with evidence
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
```

## Deployment

Production endpoints are deployed on Vercel:

- `/api/slack/commands`
- `/api/slack/events`
- `/api/slack/actions`
- `/api/health`

See [docs/deployment.md](docs/deployment.md) for Slack and Vercel setup.

## Hackathon Track

Primary track: **New Slack Agent**.

SecureLore fits the challenge by building a Slack-native agent workflow that automates app review, surfaces policy-grounded insights, connects external memory and model systems, and creates artifacts that help teams make safer install decisions.

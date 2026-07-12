# SecureLore Architecture

SecureLore is a Slack-native review workflow for teams building Slack agents, MCP integrations, and Marketplace-ready apps. It turns app manifests, MCP tool metadata, and builder evidence into an admin-ready decision packet.

## System Flow

```mermaid
flowchart LR
  Builder[Slack builder or reviewer] --> Slack[Slack Agent UI, command, App Home]
  Slack -->|command, modal, actions| Vercel[Vercel HTTPS endpoints]
  Vercel --> Bolt[Bolt for JavaScript app]
  Bolt --> ReviewCore[review-core deterministic checks]
  Bolt --> Policy[Policy context provider]
  Policy --> Cohere[Cohere embeddings]
  Policy --> Neon[(Neon Postgres + pgvector)]
  Bolt --> OpenRouter[OpenRouter LLM enrichment]
  ReviewCore --> Packet[Structured review packet]
  OpenRouter --> Packet
  Packet --> Evidence[Evidence scoring and regrading]
  Evidence --> Decision[Human decision gate]
  Packet --> SlackUI[Block Kit review packet]
  SlackUI --> Builder
```

## Review Room And Learning Loop

```mermaid
sequenceDiagram
  participant U as Builder/Admin
  participant S as Slack
  participant A as SecureLore Bolt app
  participant N as Neon memory
  participant C as Cohere embeddings

  U->>S: Add evidence to a finding
  S->>A: block_actions + modal submission
  A->>A: Score relevance, specificity, testability, policy alignment
  A->>N: Store evidence and regraded packet
  A->>S: Repost Review Room with rationale and updated risk
  U->>S: Submit corrected artifacts
  A->>N: Link parent and corrected review
  A->>S: Show resolved, remaining, and new findings
  U->>S: Record human decision
  A->>N: Persist actor, rationale, and timestamp
  U->>S: Promote sanitized lesson
  S->>A: lesson modal submission
  A->>C: Embed sanitized lesson
  A->>N: Store learning example
  U->>S: Run future similar review
  A->>C: Embed review query
  A->>N: Retrieve policy chunks and learned lessons
  A->>S: Show review packet, lessons used, and learning trace
```

## Data Boundaries

```mermaid
flowchart TB
  Inputs[Manifest JSON, MCP tools/list JSON, evidence] --> ReviewData[Workspace-scoped review records]
  ReviewData --> Neon[(Neon Postgres)]
  Inputs --> Redaction[Sanitized lesson promotion]
  Redaction --> Learned[Learning examples]
  Learned --> Neon
  Learned --> Retrieval[Future retrieval context]
  Feedback[Missed issue or false alarm] --> Eval[(Candidate regression eval)]
  Retrieval --> LLM[LLM review enrichment]
  Inputs -. not used for training .-> NoTraining[No model training]
  LLM -. output only .-> ReviewPacket[Review packet]
```

## Runtime Components

```mermaid
flowchart TD
  subgraph Slack_Surface[Slack surface]
    Agent[Agent/Assistant conversation]
    Slash[/securelore review/]
    Modal[Review, evidence, and lesson modals]
    Home[App Home dashboard]
    Room[Review Room]
  end

  subgraph App_Runtime[Vercel + Bolt runtime]
    Receiver[ExpressReceiver]
    Handlers[Commands, events, views, actions]
    Renderers[Block Kit renderers]
  end

  subgraph Intelligence[Review intelligence]
    Core[Deterministic rules]
    Agent[OpenRouter enrichment]
    Memory[Policy and learning retrieval]
  end

  subgraph Storage[Storage]
    Sessions[(review_sessions)]
    Artifacts[(review_artifacts)]
    Feedback[(feedback_events)]
    Evals[(eval_cases)]
    Lessons[(learning_examples)]
    Policies[(policy_chunks)]
  end

  Slack_Surface --> Receiver
  Receiver --> Handlers
  Handlers --> Core
  Handlers --> Agent
  Handlers --> Memory
  Memory --> Policies
  Memory --> Lessons
  Lessons -. scoped by Slack team .-> Memory
  Handlers --> Sessions
  Handlers --> Artifacts
  Handlers --> Feedback
  Core --> Renderers
  Agent --> Renderers
  Renderers --> Slack_Surface
```

# SecureLore Architecture

SecureLore is a Slack-native review workflow for teams building Slack agents, MCP integrations, and Marketplace-ready apps. It turns app manifests, MCP tool metadata, and builder evidence into an admin-ready decision packet.

## System Flow

```mermaid
flowchart LR
  Builder[Slack builder or admin] -->|/securelore review| Slack[Slack workspace]
  Slack -->|command, modal, actions| Vercel[Vercel HTTPS endpoints]
  Vercel --> Bolt[Bolt for JavaScript app]
  Bolt --> ReviewCore[review-core deterministic checks]
  Bolt --> Policy[Policy context provider]
  Policy --> Cohere[Cohere embeddings]
  Policy --> Neon[(Neon Postgres + pgvector)]
  Bolt --> OpenRouter[OpenRouter LLM enrichment]
  ReviewCore --> Packet[Structured review packet]
  OpenRouter --> Packet
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
  A->>N: Store review-specific evidence
  A->>S: Repost Review Room with latest evidence
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
  Inputs[Manifest JSON, MCP tools/list JSON, evidence] --> ReviewData[Review records and artifacts]
  ReviewData --> Neon[(Neon Postgres)]
  Inputs --> Redaction[Sanitized lesson promotion]
  Redaction --> Learned[Learning examples]
  Learned --> Neon
  Learned --> Retrieval[Future retrieval context]
  Retrieval --> LLM[LLM review enrichment]
  Inputs -. not used for training .-> NoTraining[No model training]
  LLM -. output only .-> ReviewPacket[Review packet]
```

## Runtime Components

```mermaid
flowchart TD
  subgraph Slack_Surface[Slack surface]
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
  Handlers --> Sessions
  Handlers --> Artifacts
  Handlers --> Feedback
  Core --> Renderers
  Agent --> Renderers
  Renderers --> Slack_Surface
```

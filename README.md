# SecureLore

SecureLore is a Slack-native preflight control plane for Slack agents, MCP tools, and Marketplace submissions.

It reviews a proposed Slack agent before it enters a workspace, then produces the artifacts a builder, workspace admin, or Marketplace reviewer needs to trust it:

- install risk grade
- OAuth scope justification table
- Slack Marketplace readiness checklist
- MCP tool safety review
- privacy and AI disclosure review
- safer manifest diff
- admin approval brief
- eval-backed review packet

## Hackathon Target

Primary track: **New Slack Agent**

SecureLore uses Slack as the working surface and MCP/Eve as the agentic review layer. The Organizations track is treated as optional because Slack Marketplace submission adds operational constraints such as production deployment and active non-sandbox workspace installs.

## Architecture

```txt
Slack workspace
  -> Bolt app
    -> Eve agent workflow
      -> review-core parsers
      -> policy retrieval
      -> MCP tool analyzers
      -> eval and learning memory
    -> Block Kit review packet
```

Bolt owns Slack plumbing: slash commands, modals, App Home, interactivity, file uploads, OAuth, and request verification.

Eve owns agent intelligence: artifact classification, policy-grounded reasoning, review workflow state, skills, scheduled evals, and learning from feedback.

## Phase 1 Contents

- [packages/review-core/schemas/review-packet.schema.json](packages/review-core/schemas/review-packet.schema.json)
- [artifacts/samples/bad-support-agent.manifest.json](artifacts/samples/bad-support-agent.manifest.json)
- [artifacts/samples/fixed-support-agent.manifest.json](artifacts/samples/fixed-support-agent.manifest.json)
- [artifacts/samples/bad-mcp-tools.json](artifacts/samples/bad-mcp-tools.json)
- [artifacts/samples/fixed-mcp-tools.json](artifacts/samples/fixed-mcp-tools.json)
- [artifacts/evals/phase1-regression-cases.jsonl](artifacts/evals/phase1-regression-cases.jsonl)

Internal planning docs live in `.internal/` and are intentionally ignored.

## Build Direction

SecureLore is not a hardcoded linter. It combines deterministic preflight checks with policy-grounded agent reasoning and an eval-gated learning loop.

Deterministic checks catch objective blockers such as missing privacy URLs, absent MCP `readOnlyHint`, unconfigured support pages, or broad scopes with no declared feature mapping.

The agent reasons over intent, policy, and artifacts to decide whether a risky permission is justified, generate safer alternatives, and produce reviewer-ready explanations.

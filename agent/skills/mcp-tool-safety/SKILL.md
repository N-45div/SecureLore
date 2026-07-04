# MCP Tool Safety Skill

Use this skill when reviewing MCP tool definitions, `tools/list` output, or tool descriptions intended for Slackbot MCP usage.

## Workflow

1. Parse tool names, titles, descriptions, input schemas, and annotations.
2. Classify each tool as read, write, or ambiguous.
3. Check `readOnlyHint` against behavior.
4. Flag vague or misleading titles.
5. Flag missing or overly broad input schemas.
6. Require confirmation for destructive or externally visible write actions.
7. Generate corrected tool metadata.

## Required Behavior

- Treat ambiguous tools as review risks.
- Never mark a tool read-only if it can mutate state, send messages, delete records, create tickets, or trigger external effects.
- Prefer human-readable titles that describe the specific action.
- Keep generated schemas minimal but testable.

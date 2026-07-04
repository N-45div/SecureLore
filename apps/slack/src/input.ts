import { reviewArtifacts } from "@securelore/review-core";
import type { McpToolsListLike, ReviewPacket, SlackManifestLike } from "@securelore/review-core";

export interface SlackReviewFormInput {
  manifestJson?: string;
  mcpToolsJson?: string;
}

export function runReviewFromForm(input: SlackReviewFormInput): ReviewPacket {
  const manifest = input.manifestJson?.trim()
    ? (parseJson(input.manifestJson, "Slack manifest JSON") as SlackManifestLike)
    : undefined;
  const mcpTools = input.mcpToolsJson?.trim()
    ? (parseJson(input.mcpToolsJson, "MCP tools JSON") as McpToolsListLike)
    : undefined;

  if (!manifest && !mcpTools) {
    throw new Error("Paste a Slack manifest, MCP tools/list response, or both.");
  }

  return reviewArtifacts({ manifest, mcpTools });
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${label} could not be parsed: ${message}`);
  }
}

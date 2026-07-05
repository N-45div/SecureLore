import { reviewArtifacts } from "@securelore/review-core";
import type {
  McpToolsListLike,
  PolicyContext,
  ReviewPacket,
  SlackManifestLike
} from "@securelore/review-core";

export interface SlackReviewFormInput {
  manifestJson?: string;
  mcpToolsJson?: string;
  policyContext?: PolicyContext[];
}

export interface ClassifiedJsonArtifact {
  manifestJson?: string;
  mcpToolsJson?: string;
  artifactKind: "slack_manifest" | "mcp_tools" | "combined";
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

  return reviewArtifacts({ manifest, mcpTools, policyContext: input.policyContext });
}

export function classifyJsonArtifact(rawJson: string): ClassifiedJsonArtifact {
  const parsed = parseJson(rawJson, "Uploaded JSON") as Record<string, unknown>;
  const pretty = JSON.stringify(parsed, null, 2);
  const isMcpTools = Array.isArray(parsed.tools);
  const isSlackManifest =
    typeof parsed.display_information === "object" ||
    typeof parsed.oauth_config === "object" ||
    typeof parsed.features === "object" ||
    typeof parsed.settings === "object";

  if (isSlackManifest && isMcpTools) {
    return {
      artifactKind: "combined",
      manifestJson: pretty,
      mcpToolsJson: pretty
    };
  }

  if (isSlackManifest) {
    return {
      artifactKind: "slack_manifest",
      manifestJson: pretty
    };
  }

  if (isMcpTools) {
    return {
      artifactKind: "mcp_tools",
      mcpToolsJson: pretty
    };
  }

  throw new Error("Uploaded JSON is not recognized as a Slack manifest or MCP tools/list response.");
}

export function buildPolicyQueryFromForm(input: SlackReviewFormInput): string {
  const parts = [
    "Review Slack app and MCP tool safety.",
    input.manifestJson?.slice(0, 4000),
    input.mcpToolsJson?.slice(0, 4000)
  ].filter(Boolean);

  return parts.join("\n\n");
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${label} could not be parsed: ${message}`);
  }
}

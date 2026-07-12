import { reviewArtifacts } from "@securelore/review-core";
import type {
  McpToolsListLike,
  PolicyContext,
  ReviewContext,
  ReviewPacket,
  SlackManifestLike
} from "@securelore/review-core";

export interface SlackReviewFormInput {
  manifestJson?: string;
  mcpToolsJson?: string;
  policyContext?: PolicyContext[];
  declaredFeaturesText?: string;
  publicPagesText?: string;
  aiModel?: string;
  aiRetention?: string;
  aiTrainingUse?: string;
  scopeJustificationsText?: string;
  consequentialActionsText?: string;
  humanReviewControls?: string;
  runtimeEvidenceText?: string;
  workspacePolicyJson?: string;
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

  return reviewArtifacts({
    manifest,
    mcpTools,
    policyContext: input.policyContext,
    reviewContext: buildReviewContext(input)
  });
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
    input.mcpToolsJson?.slice(0, 4000),
    input.declaredFeaturesText?.slice(0, 1200),
    input.scopeJustificationsText?.slice(0, 1600),
    input.aiModel?.slice(0, 200),
    input.aiRetention?.slice(0, 600),
    input.aiTrainingUse?.slice(0, 300),
    input.runtimeEvidenceText?.slice(0, 1600),
    input.workspacePolicyJson?.slice(0, 1600)
  ].filter(Boolean);

  return parts.join("\n\n");
}

export function buildReviewContext(input: SlackReviewFormInput): ReviewContext {
  return {
    declaredFeatures: splitLines(input.declaredFeaturesText),
    publicPages: parseKeyValueLines(input.publicPagesText, {
      landing: "landingPageUrl",
      privacy: "privacyPolicyUrl",
      support: "supportPageUrl"
    }),
    aiDisclosure: {
      model: clean(input.aiModel),
      retention: clean(input.aiRetention),
      trainingUse: clean(input.aiTrainingUse)
    },
    scopeJustifications: parseKeyValueLines(input.scopeJustificationsText) as Record<string, string>,
    consequentialActions: splitLines(input.consequentialActionsText),
    humanReviewControls: clean(input.humanReviewControls),
    runtimeEvidence: parseRuntimeEvidence(input.runtimeEvidenceText),
    workspacePolicy: parseWorkspacePolicy(input.workspacePolicyJson)
  };
}

function splitLines(value?: string): string[] {
  return (value ?? "")
    .split("\n")
    .map((item) => item.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 30);
}

function parseKeyValueLines<T extends Record<string, string> = Record<string, string>>(
  value?: string,
  aliases?: Record<string, string>
): Partial<T> {
  const result: Record<string, string> = {};
  for (const line of splitLines(value)) {
    const separator = line.includes("=") ? "=" : ":";
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    const rawKey = line.slice(0, index).trim();
    const parsedValue = line.slice(index + 1).trim();
    const key = aliases?.[rawKey.toLowerCase()] ?? rawKey;
    if (key && parsedValue) result[key] = parsedValue;
  }
  return result as Partial<T>;
}

function clean(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function parseRuntimeEvidence(value?: string): ReviewContext["runtimeEvidence"] {
  return splitLines(value).flatMap((line) => {
    const [kind, status, description, reference] = line.split("|").map((part) => part.trim());
    const allowedKinds = new Set(["endpoint_health", "request_signing", "scope_feature_test", "mcp_action_guard", "retention_control", "other"]);
    const allowedStatuses = new Set(["declared", "verified", "not_verified", "contradicted"]);
    if (!allowedKinds.has(kind) || !allowedStatuses.has(status) || !description) return [];
    return [{
      kind: kind as NonNullable<ReviewContext["runtimeEvidence"]>[number]["kind"],
      status: status as NonNullable<ReviewContext["runtimeEvidence"]>[number]["status"],
      description,
      reference: reference || undefined
    }];
  });
}

function parseWorkspacePolicy(value?: string): ReviewContext["workspacePolicy"] {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as ReviewContext["workspacePolicy"];
    return parsed?.name ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${label} could not be parsed: ${message}`);
  }
}

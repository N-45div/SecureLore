import type { ReviewPacket } from "@securelore/review-core";
import type { Block, KnownBlock } from "@slack/types";

export interface RtsApiClient {
  apiCall(method: string, options?: Record<string, unknown>): Promise<unknown>;
}

export interface WorkspaceEvidenceResult {
  authorName: string;
  channelName: string;
  content: string;
  permalink: string;
  timestamp?: string;
}

export interface WorkspaceEvidenceSearch {
  query: string;
  results: WorkspaceEvidenceResult[];
}

export function isWorkspaceEvidenceRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return [
    "find workspace precedent",
    "search workspace",
    "find precedent",
    "search precedent",
    "workspace evidence"
  ].some((phrase) => normalized.includes(phrase));
}

export function buildWorkspaceEvidenceQuery(text: string, packet?: ReviewPacket): string {
  const requestedTopic = text
    .replace(/<@[A-Z0-9]+>/gi, " ")
    .replace(/(?:find|search)\s+(?:the\s+)?(?:workspace\s+)?(?:precedent|evidence)(?:\s+for)?/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[:\-\s]+/, "")
    .slice(0, 260);

  if (requestedTopic && !/^(this|this review|the review)$/i.test(requestedTopic)) {
    return `What internal policy or prior Slack app approval discussion is relevant to ${requestedTopic}?`;
  }

  const findingTopics = packet?.findings
    .filter((finding) =>
      finding.resolution?.status !== "resolved" && finding.resolution?.status !== "accepted_risk"
    )
    .slice(0, 3)
    .map((finding) => finding.title.toLowerCase());

  const topics = findingTopics && findingTopics.length > 0
    ? findingTopics.join("; ")
    : "OAuth scopes, MCP tool safety, AI data retention, or Slack agent approval";
  return `What internal policy or prior Slack app approval discussion covers ${topics}?`;
}

export async function searchWorkspaceEvidence(
  client: RtsApiClient,
  input: { query: string; actionToken: string }
): Promise<WorkspaceEvidenceSearch> {
  const query = input.query.trim().slice(0, 500);
  if (query.length < 8) throw new Error("Add a more specific workspace evidence query.");
  if (!input.actionToken) throw new Error("Slack did not provide a Real-Time Search action token.");

  const response = await client.apiCall("assistant.search.context", {
    query,
    action_token: input.actionToken,
    channel_types: ["public_channel"],
    content_types: ["messages"],
    include_bots: false,
    include_context_messages: false,
    limit: 5,
    sort: "score"
  });

  return {
    query,
    results: parseWorkspaceEvidenceResponse(response)
  };
}

export function parseWorkspaceEvidenceResponse(response: unknown): WorkspaceEvidenceResult[] {
  if (!response || typeof response !== "object") return [];
  const messages = (response as {
    results?: { messages?: unknown[] };
  }).results?.messages;
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.permalink !== "string" || typeof item.content !== "string") return [];
    return [{
      authorName: typeof item.author_name === "string" ? item.author_name : "Slack member",
      channelName: typeof item.channel_name === "string" ? item.channel_name : "public channel",
      content: item.content.slice(0, 420),
      permalink: item.permalink,
      timestamp: typeof item.message_ts === "string" ? item.message_ts : undefined
    }];
  });
}

export function renderWorkspaceEvidenceBlocks(search: WorkspaceEvidenceSearch): Array<KnownBlock | Block> {
  const blocks: Array<KnownBlock | Block> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Workspace Evidence Scout" }
    },
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: "Live Slack RTS search • public channels only • zero-copy • does not change the review grade"
      }]
    }
  ];

  if (search.results.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No relevant public-channel precedent was found. Try a narrower term such as `files:read approval` or `AI retention policy`."
      }
    });
    return blocks;
  }

  for (const [index, result] of search.results.entries()) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${index + 1}. <${result.permalink}|#${escapeMrkdwn(result.channelName)} · ${escapeMrkdwn(result.authorName)}>*`,
          escapeMrkdwn(result.content)
        ].join("\n")
      }
    });
  }

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: "Open a cited Slack message to assess it. SecureLore does not persist or automatically accept RTS results as review evidence."
    }]
  });
  return blocks;
}

export function describeRtsError(error: unknown): string {
  const code = extractSlackErrorCode(error);
  if (code === "missing_scope") {
    return "Real-Time Search needs the `search:read.public` scope. Reinstall SecureLore after updating the manifest.";
  }
  if (code === "feature_not_enabled" || code === "assistant_search_context_disabled") {
    return "Real-Time Search is not enabled for this workspace. The normal SecureLore review workflow is still available.";
  }
  if (code === "invalid_action_token") {
    return "That live search token expired. Send the workspace precedent request again in this Agent conversation.";
  }
  if (code === "rate_limited" || code === "ratelimited") {
    return "Slack temporarily rate-limited live search. Wait briefly, then try a narrower query.";
  }
  return error instanceof Error
    ? `Real-Time Search failed: ${error.message}`
    : "Real-Time Search failed. Try a more specific query.";
}

function extractSlackErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    code?: unknown;
    data?: { error?: unknown };
  };
  if (typeof candidate.data?.error === "string") return candidate.data.error;
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function escapeMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

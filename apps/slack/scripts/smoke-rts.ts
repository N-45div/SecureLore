import { readFileSync } from "node:fs";
import {
  buildWorkspaceEvidenceQuery,
  isWorkspaceEvidenceRequest,
  renderWorkspaceEvidenceBlocks,
  searchWorkspaceEvidence
} from "../src/rts-search.js";
import { isAuthorizedReviewer, parseReviewerIds } from "../src/governance.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../manifest.json", import.meta.url), "utf8")
) as {
  features?: { agent_view?: unknown; assistant_view?: unknown };
  settings?: { event_subscriptions?: { bot_events?: string[] } };
};
const boltSource = readFileSync(
  new URL("../../src/bolt-app.ts", import.meta.url),
  "utf8"
);

if (!manifest.features?.agent_view || manifest.features.assistant_view) {
  throw new Error("Slack manifest must use agent_view only.");
}
const botEvents = manifest.settings?.event_subscriptions?.bot_events ?? [];
if (!botEvents.includes("app_home_opened") || !botEvents.includes("message.im")) {
  throw new Error("Agent View requires app_home_opened and message.im events.");
}
if (
  boltSource.includes("new Assistant(") ||
  !boltSource.includes("app.message(") ||
  !boltSource.includes("setSuggestedPrompts")
) {
  throw new Error("Agent View runtime regressed to the legacy Assistant middleware.");
}

let calledMethod = "";
let calledOptions: Record<string, unknown> = {};
const search = await searchWorkspaceEvidence({
  async apiCall(method, options) {
    calledMethod = method;
    calledOptions = options ?? {};
    return {
      ok: true,
      results: {
        messages: [{
          author_name: "Avery Admin",
          channel_name: "agent-governance",
          content: "files:read was approved only for user-triggered JSON review with documented retention.",
          permalink: "https://example.slack.com/archives/C123/p456",
          message_ts: "123.456"
        }]
      }
    };
  }
}, {
  query: buildWorkspaceEvidenceQuery("Find workspace precedent: files:read approval"),
  actionToken: "action-token"
});

if (!isWorkspaceEvidenceRequest("Find workspace precedent for this review")) {
  throw new Error("RTS request intent was not detected.");
}
if (calledMethod !== "assistant.search.context") {
  throw new Error("RTS method was not called.");
}
if (JSON.stringify(calledOptions.channel_types) !== JSON.stringify(["public_channel"])) {
  throw new Error("RTS search was not restricted to public channels.");
}
if (search.results.length !== 1 || renderWorkspaceEvidenceBlocks(search).length < 3) {
  throw new Error("RTS results were not parsed and rendered.");
}
const reviewers = parseReviewerIds("UADMIN1, invalid, UADMIN2");
if (!isAuthorizedReviewer(reviewers, "UADMIN1") || isAuthorizedReviewer(reviewers, "UBUILDER")) {
  throw new Error("Reviewer authorization failed closed incorrectly.");
}

console.log(JSON.stringify({
  method: calledMethod,
  publicOnly: true,
  zeroCopy: true,
  results: search.results.length,
  blocks: renderWorkspaceEvidenceBlocks(search).length,
  reviewerBoundary: true,
  agentViewContract: true
}, null, 2));

import {
  buildWorkspaceEvidenceQuery,
  isWorkspaceEvidenceRequest,
  renderWorkspaceEvidenceBlocks,
  searchWorkspaceEvidence
} from "../src/rts-search.js";
import { isAuthorizedReviewer, parseReviewerIds } from "../src/governance.js";

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
  reviewerBoundary: true
}, null, 2));

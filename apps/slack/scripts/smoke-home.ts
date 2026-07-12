import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAppHome } from "@securelore/slack-ui";
import { runReviewFromForm } from "../src/input.js";
import { LocalStore } from "../src/storage/local-store.js";
import { ReviewStore } from "../src/storage/review-store.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");

const [manifestJson, mcpToolsJson] = await Promise.all([
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);

const store = new ReviewStore({
  local: new LocalStore(join(repoRoot, ".data/smoke-home"))
});

const packet = runReviewFromForm({ manifestJson, mcpToolsJson });
await store.saveReview(packet, {
  slackTeamId: "T_SMOKE",
  slackUserId: "U_SMOKE"
});

const reviews = await store.listRecentReviews({
  slackTeamId: "T_SMOKE",
  slackUserId: "U_SMOKE",
  limit: 5
});

const blocks = renderAppHome(reviews);
const reviewerBlocks = renderAppHome(reviews, { reviewerMode: true });
const localDeletionAvailable = await store.deleteUserData("T_SMOKE", "U_SMOKE");
console.log(JSON.stringify({
  reviews: reviews.length,
  firstGrade: reviews[0]?.grade,
  blocks: blocks.length,
  reviewerBlocks: reviewerBlocks.length,
  localDeletionAvailable
}, null, 2));

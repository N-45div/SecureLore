import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAppHome } from "@securelore/slack-ui";
import { runReviewFromForm } from "../src/input.js";
import { LocalStore } from "../src/storage/local-store.js";
import { ReviewStore } from "../src/storage/review-store.js";
import { lessonModal } from "../src/bolt-app.js";

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
const lessonInput = lessonModal("review-smoke").blocks.find(
  (block) => block.block_id === "lesson_block"
) as { element?: { placeholder?: { text?: string } } } | undefined;
const lessonPlaceholder = lessonInput?.element?.placeholder?.text ?? "";
assert.ok(
  lessonPlaceholder.length <= 150,
  `Slack input placeholders must be at most 150 characters; received ${lessonPlaceholder.length}.`
);
const boltSource = await readFile(join(repoRoot, "apps/slack/src/bolt-app.ts"), "utf8");
assert.match(
  boltSource,
  /room_promote_lesson[\s\S]{0,500}if \(!isReviewer\(body\.user\.id\)\)/,
  "Lesson promotion must enforce reviewer authorization on the server."
);
console.log(JSON.stringify({
  reviews: reviews.length,
  firstGrade: reviews[0]?.grade,
  blocks: blocks.length,
  reviewerBlocks: reviewerBlocks.length,
  localDeletionAvailable,
  lessonPlaceholderLength: lessonPlaceholder.length,
  lessonPromotionReviewerGuard: true
}, null, 2));
import assert from "node:assert/strict";

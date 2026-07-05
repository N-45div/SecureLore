import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReviewPacket } from "@securelore/slack-ui";
import { classifySlackFileJson, validateJsonFile } from "../src/file-ingestion.js";
import { runReviewFromForm } from "../src/input.js";
import { LocalStore } from "../src/storage/local-store.js";
import { ReviewStore } from "../src/storage/review-store.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");

validateJsonFile({
  id: "F_SMOKE",
  name: "bad-support-agent.manifest.json",
  mimetype: "application/json",
  url_private_download: "https://example.com/file.json"
});

const rawJson = await readFile(
  join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"),
  "utf8"
);
const classified = classifySlackFileJson(rawJson);
const packet = runReviewFromForm(classified);
const store = new ReviewStore({
  local: new LocalStore(join(repoRoot, ".data/smoke-file-ingestion"))
});
await store.saveReview(packet, {
  slackTeamId: "T_SMOKE",
  slackChannelId: "C_SMOKE",
  slackUserId: "U_SMOKE"
});

console.log(JSON.stringify({
  artifactKind: classified.artifactKind,
  grade: packet.overallRisk.grade,
  findings: packet.findings.length,
  blocks: renderReviewPacket(packet).length
}, null, 2));

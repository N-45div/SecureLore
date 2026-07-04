import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReviewFromForm } from "../src/input.js";
import { LocalStore } from "../src/storage/local-store.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");

const [manifestJson, mcpToolsJson] = await Promise.all([
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);

const packet = runReviewFromForm({ manifestJson, mcpToolsJson });
const store = new LocalStore(join(repoRoot, ".data/smoke"));
await store.saveReview(packet);

console.log(JSON.stringify({
  reviewId: packet.reviewId,
  grade: packet.overallRisk.grade,
  findings: packet.findings.length,
  actions: packet.recommendedActions.length
}, null, 2));

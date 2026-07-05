import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderGeneratedArtifact, renderReviewPacket } from "@securelore/slack-ui";
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
  local: new LocalStore(join(repoRoot, ".data/smoke-artifacts"))
});

const packet = runReviewFromForm({ manifestJson, mcpToolsJson });
await store.saveReview(packet);

const saved = await store.getReview(packet.reviewId);
if (!saved) {
  throw new Error("Saved review could not be loaded.");
}

const adminBrief = saved.generatedArtifacts?.find(
  (artifact) => artifact.type === "admin_approval_brief"
);
const scopeTable = saved.generatedArtifacts?.find(
  (artifact) => artifact.type === "scope_justification_table"
);
const mcpMetadata = saved.generatedArtifacts?.find(
  (artifact) => artifact.type === "mcp_tool_metadata"
);

if (!adminBrief || !scopeTable || !mcpMetadata) {
  throw new Error("Expected generated artifacts were not found.");
}

console.log(JSON.stringify({
  reviewBlocks: renderReviewPacket(saved).length,
  adminBriefBlocks: renderGeneratedArtifact(saved, adminBrief).length,
  scopeTableBlocks: renderGeneratedArtifact(saved, scopeTable).length,
  mcpMetadataBlocks: renderGeneratedArtifact(saved, mcpMetadata).length
}, null, 2));

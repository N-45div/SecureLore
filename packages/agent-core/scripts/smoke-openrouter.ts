import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewArtifacts } from "@securelore/review-core";
import { enrichReviewPacket } from "../src/index.js";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.log("Skipping OpenRouter smoke: OPENROUTER_API_KEY is required.");
  process.exit(0);
}

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");
const [manifest, mcpTools] = await Promise.all([
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);
const packet = reviewArtifacts({
  manifest: JSON.parse(manifest),
  mcpTools: JSON.parse(mcpTools)
});
const enriched = await enrichReviewPacket(packet, {
  openRouterApiKey: apiKey,
  model: process.env.OPENROUTER_MODEL
});

console.log(JSON.stringify({
  grade: enriched.overallRisk.grade,
  generatedArtifacts: enriched.generatedArtifacts?.map((artifact) => artifact.type),
  enrichmentCheck: enriched.evalTrace?.checks?.find(
    (check) => check.name === "eve_openrouter_enrichment"
  )
}, null, 2));

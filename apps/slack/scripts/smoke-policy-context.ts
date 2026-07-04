import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolicyQueryFromForm, runReviewFromForm } from "../src/input.js";
import { createPolicyContextProvider } from "../src/policy-context.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");

if (!process.env.DATABASE_URL || !process.env.COHERE_API_KEY) {
  console.log("Skipping policy-context smoke: DATABASE_URL and COHERE_API_KEY are required.");
  process.exit(0);
}

const [manifestJson, mcpToolsJson] = await Promise.all([
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);

const provider = createPolicyContextProvider(process.env);
const policyContext = await provider.retrieve(
  buildPolicyQueryFromForm({ manifestJson, mcpToolsJson })
);
const packet = runReviewFromForm({ manifestJson, mcpToolsJson, policyContext });

console.log(JSON.stringify({
  reviewId: packet.reviewId,
  grade: packet.overallRisk.grade,
  policyContext: packet.policyContext?.map((policy) => ({
    id: policy.id,
    similarity: policy.similarity
  }))
}, null, 2));

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolicyQueryFromForm, runReviewFromForm } from "../src/input.js";
import {
  createPolicyContextProvider,
  ResilientPolicyContextProvider,
  type PolicyContextProvider
} from "../src/policy-context.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");

const hangingProvider: PolicyContextProvider = {
  retrieve: () => new Promise(() => undefined)
};
const fallbackEvents: string[] = [];
const fallbackProvider = new ResilientPolicyContextProvider(hangingProvider, {
  timeoutMs: 20,
  logger: (event) => fallbackEvents.push(event)
});
const fallbackStartedAt = Date.now();
const fallback = await fallbackProvider.retrieve("MCP readOnlyHint and AI human review");
assert.ok(Date.now() - fallbackStartedAt < 500, "Policy fallback should respect its deadline.");
assert.ok(fallback.some((item) => item.id === "slack-mcp.tool-discovery"));
assert.ok(fallbackEvents.includes("policy_memory_fallback"));

const retrievedProvider = new ResilientPolicyContextProvider({
  retrieve: async () => [{
    id: "learning:test",
    title: "Promoted workspace lesson",
    source: "securelore-learning",
    excerpt: "A real promoted lesson."
  }]
}, { timeoutMs: 20 });
const retrieved = await retrievedProvider.retrieve("workspace lesson", "T123");
assert.equal(retrieved[0]?.id, "learning:test", "Retrieved memory must win over fallback context.");

const [manifestJson, mcpToolsJson] = await Promise.all([
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);

const provider = createPolicyContextProvider(process.env, { timeoutMs: 6_000 });
const policyContext = await provider.retrieve(buildPolicyQueryFromForm({ manifestJson, mcpToolsJson }));
const packet = runReviewFromForm({ manifestJson, mcpToolsJson, policyContext });

console.log(JSON.stringify({
  reviewId: packet.reviewId,
  grade: packet.overallRisk.grade,
  policyContext: packet.policyContext?.map((policy) => ({
    id: policy.id,
    similarity: policy.similarity
  })),
  liveMemoryConfigured: Boolean(process.env.DATABASE_URL && process.env.COHERE_API_KEY),
  resilientFallback: "passed"
}, null, 2));

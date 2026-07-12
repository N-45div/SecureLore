import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolicyQueryFromForm, runReviewFromForm } from "../src/input.js";
import { LocalStore } from "../src/storage/local-store.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");

const [manifestJson, mcpToolsJson, contextJson] = await Promise.all([
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8"),
  readFile(join(repoRoot, "artifacts/samples/bad-support-agent.context.json"), "utf8")
]);
const context = JSON.parse(contextJson);
const formInput = {
  manifestJson,
  mcpToolsJson,
  declaredFeaturesText: context.declaredFeatures.join("\n"),
  publicPagesText: "landing=\nprivacy=\nsupport=",
  aiModel: context.aiDisclosure.model,
  aiRetention: context.aiDisclosure.retention,
  aiTrainingUse: context.aiDisclosure.trainingUse,
  consequentialActionsText: context.consequentialActions.join("\n"),
  humanReviewControls: context.humanReviewControls
};

const packet = runReviewFromForm(formInput);
const store = new LocalStore(join(repoRoot, ".data/smoke"));
await store.saveReview(packet);

console.log(JSON.stringify({
  reviewId: packet.reviewId,
  grade: packet.overallRisk.grade,
  findings: packet.findings.length,
  actions: packet.recommendedActions.length,
  fingerprint: packet.artifactFingerprint.slice(0, 20),
  policyQueryLength: buildPolicyQueryFromForm(formInput).length
}, null, 2));

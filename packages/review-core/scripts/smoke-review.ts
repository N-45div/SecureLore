import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEvidenceAssessment, reviewArtifacts } from "../src/index.js";
import type { McpToolsListLike, SlackManifestLike } from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(currentDir, "../../../..");

const [manifestRaw, toolsRaw] = await Promise.all([
  readFile(join(root, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(root, "artifacts/samples/bad-mcp-tools.json"), "utf8")
]);

const manifest = JSON.parse(manifestRaw) as SlackManifestLike;
const mcpTools = JSON.parse(toolsRaw) as McpToolsListLike;

const packet = reviewArtifacts({
  manifest,
  mcpTools,
  fixtureIds: ["sg-001-broad-history-scopes", "sg-004-mcp-vague-write-tool"]
});

const evidenceResolved = applyEvidenceAssessment(packet, "scope-channels-history", {
  decision: "sufficient",
  rationale: "The tested feature searches only channels the requesting user can access and retains no message content.",
  evaluatedBy: "securelore-smoke",
  evaluatedAt: new Date().toISOString()
});
assert.equal(
  evidenceResolved.findings.find((finding) => finding.id === "scope-channels-history")?.resolution?.status,
  "resolved"
);
assert.match(evidenceResolved.overallRisk.summary, /resolved by evidence/);

const artifactBlocker = applyEvidenceAssessment(packet, "insecure-slack-endpoints", {
  decision: "sufficient",
  rationale: "The builder says deployment will happen later.",
  evaluatedBy: "securelore-smoke",
  evaluatedAt: new Date().toISOString()
});
assert.equal(
  artifactBlocker.findings.find((finding) => finding.id === "insecure-slack-endpoints")?.resolution?.status,
  "evidence_submitted"
);

console.log(JSON.stringify({
  grade: packet.overallRisk.grade,
  findings: packet.findings.length,
  evidenceResolution: evidenceResolved.findings.find(
    (finding) => finding.id === "scope-channels-history"
  )?.resolution?.status,
  artifactGuard: artifactBlocker.findings.find(
    (finding) => finding.id === "insecure-slack-endpoints"
  )?.resolution?.status
}, null, 2));

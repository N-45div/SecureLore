import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEvidenceAssessment, compareReviewPackets, reviewArtifacts } from "../src/index.js";
import type { McpToolsListLike, ReviewContext, SlackManifestLike } from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(currentDir, "../../../..");

const [manifestRaw, toolsRaw, contextRaw, fixedManifestRaw, fixedToolsRaw, fixedContextRaw] = await Promise.all([
  readFile(join(root, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
  readFile(join(root, "artifacts/samples/bad-mcp-tools.json"), "utf8"),
  readFile(join(root, "artifacts/samples/bad-support-agent.context.json"), "utf8"),
  readFile(join(root, "artifacts/samples/fixed-support-agent.manifest.json"), "utf8"),
  readFile(join(root, "artifacts/samples/fixed-mcp-tools.json"), "utf8"),
  readFile(join(root, "artifacts/samples/fixed-support-agent.context.json"), "utf8")
]);

const manifest = JSON.parse(manifestRaw) as SlackManifestLike;
const mcpTools = JSON.parse(toolsRaw) as McpToolsListLike;

const packet = reviewArtifacts({
  manifest,
  mcpTools,
  reviewContext: JSON.parse(contextRaw) as ReviewContext,
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

const corrected = reviewArtifacts({
  manifest: JSON.parse(fixedManifestRaw) as SlackManifestLike,
  mcpTools: JSON.parse(fixedToolsRaw) as McpToolsListLike,
  reviewContext: JSON.parse(fixedContextRaw) as ReviewContext
});
const comparison = compareReviewPackets(packet, corrected);
assert.equal(comparison.lineage?.parentReviewId, packet.reviewId);
assert.ok((comparison.comparison?.resolvedFindingIds.length ?? 0) > 0);
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
  )?.resolution?.status,
  correctedGrade: comparison.overallRisk.grade,
  resolvedByFix: comparison.comparison?.resolvedFindingIds.length
}, null, 2));

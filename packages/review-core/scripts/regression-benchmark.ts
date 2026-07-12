import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEvidenceAssessment,
  compareReviewPackets,
  reviewArtifacts,
  type McpToolsListLike,
  type SlackManifestLike
} from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(currentDir, "../../../..");
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(join(root, path), "utf8")) as T;

const [badManifest, badTools, fixedManifest, fixedTools] = await Promise.all([
  readJson<SlackManifestLike>("artifacts/samples/bad-support-agent.manifest.json"),
  readJson<McpToolsListLike>("artifacts/samples/bad-mcp-tools.json"),
  readJson<SlackManifestLike>("artifacts/samples/fixed-support-agent.manifest.json"),
  readJson<McpToolsListLike>("artifacts/samples/fixed-mcp-tools.json")
]);

const checks: Array<{ name: string; passed: boolean }> = [];
const check = (name: string, passed: boolean) => checks.push({ name, passed });
const bad = reviewArtifacts({ manifest: badManifest, mcpTools: badTools });
const fixed = reviewArtifacts({ manifest: fixedManifest, mcpTools: fixedTools });
const badIds = new Set(bad.findings.map((finding) => finding.id));
const expectedBlockers = [
  "scope-groups-history",
  "scope-mpim-history",
  "insecure-slack-endpoints",
  "missing-public-pages",
  "missing-ai-disclosure",
  "mcp-execute-action",
  "mcp-delete-ticket"
];

for (const id of expectedBlockers) {
  check(`detect:${id}`, badIds.has(id));
}
check("unsafe-sample-rejected", bad.overallRisk.grade === "reject");
check("fixed-sample-low-risk", fixed.overallRisk.grade === "low");
check(
  "fixed-sample-no-active-blockers",
  fixed.findings.every((finding) => finding.severity !== "blocker")
);
check(
  "fixed-mcp-metadata-valid",
  fixed.mcpToolReviews?.every((tool) => tool.issues.length === 0) === true
);

const sensitive = reviewArtifacts({
  manifest: {
    oauth_config: { scopes: { bot: ["files:read", "chat:write"] } },
    securelore_declared_features: ["Answer support questions"],
    securelore_public_pages: { privacy_policy_url: "https://example.com/privacy" }
  }
});
check(
  "sensitive-scope-needs-evidence",
  sensitive.findings.some(
    (finding) => finding.id === "scope-files-read" && finding.severity === "warn"
  )
);

const evidenceResolved = applyEvidenceAssessment(bad, "scope-channels-history", {
  decision: "sufficient",
  rationale: "Search is user-triggered, access-controlled, tested, and stores no message content.",
  evaluatedBy: "benchmark",
  evaluatedAt: new Date().toISOString(),
  quality: { relevance: 5, specificity: 5, testability: 5, policyAlignment: 5 }
});
check(
  "clarification-evidence-can-resolve",
  evidenceResolved.findings.find((finding) => finding.id === "scope-channels-history")
    ?.resolution?.status === "resolved"
);

const guarded = applyEvidenceAssessment(bad, "insecure-slack-endpoints", {
  decision: "sufficient",
  rationale: "The builder promises to deploy later.",
  evaluatedBy: "benchmark",
  evaluatedAt: new Date().toISOString()
});
check(
  "artifact-blocker-rejects-narrative-evidence",
  guarded.findings.find((finding) => finding.id === "insecure-slack-endpoints")
    ?.resolution?.status === "evidence_submitted"
);

const comparison = compareReviewPackets(bad, fixed);
check(
  "corrected-review-links-parent",
  comparison.lineage?.parentReviewId === bad.reviewId
);
check(
  "corrected-review-resolves-findings",
  (comparison.comparison?.resolvedFindingIds.length ?? 0) > 0
);

const passed = checks.filter((item) => item.passed).length;
const expectedDetected = expectedBlockers.filter((id) => badIds.has(id)).length;
const activeFixedBlockers = fixed.findings.filter((finding) => finding.severity === "blocker").length;
const report = {
  generatedAt: new Date().toISOString(),
  cases: checks.length,
  passed,
  failed: checks.length - passed,
  accuracy: Number((passed / checks.length).toFixed(3)),
  blockerRecall: Number((expectedDetected / expectedBlockers.length).toFixed(3)),
  safeSampleFalsePositiveBlockers: activeFixedBlockers,
  checks
};

console.log(JSON.stringify(report, null, 2));
if (passed !== checks.length) process.exitCode = 1;

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEvidenceAssessment,
  compareReviewPackets,
  recordReviewDecision,
  reviewArtifacts,
  type McpToolsListLike,
  type ReviewContext,
  type SlackManifestLike
} from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(currentDir, "../../../..");
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(join(root, path), "utf8")) as T;

const [badManifest, badTools, badContext, fixedManifest, fixedTools, fixedContext] = await Promise.all([
  readJson<SlackManifestLike>("artifacts/samples/bad-support-agent.manifest.json"),
  readJson<McpToolsListLike>("artifacts/samples/bad-mcp-tools.json"),
  readJson<ReviewContext>("artifacts/samples/bad-support-agent.context.json"),
  readJson<SlackManifestLike>("artifacts/samples/fixed-support-agent.manifest.json"),
  readJson<McpToolsListLike>("artifacts/samples/fixed-mcp-tools.json"),
  readJson<ReviewContext>("artifacts/samples/fixed-support-agent.context.json")
]);

const checks: Array<{ name: string; passed: boolean }> = [];
const check = (name: string, passed: boolean) => checks.push({ name, passed });
const bad = reviewArtifacts({ manifest: badManifest, mcpTools: badTools, reviewContext: badContext });
const fixed = reviewArtifacts({ manifest: fixedManifest, mcpTools: fixedTools, reviewContext: fixedContext });
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
    oauth_config: { scopes: { bot: ["files:read", "chat:write"] } }
  },
  reviewContext: {
    declaredFeatures: ["Answer support questions"],
    publicPages: { privacyPolicyUrl: "https://example.com/privacy" }
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

let blockedApproval = false;
try {
  recordReviewDecision(bad, {
    status: "approved",
    rationale: "Approve despite unresolved blockers.",
    decidedBy: "U_BENCHMARK",
    decidedAt: new Date().toISOString()
  });
} catch {
  blockedApproval = true;
}
check("human-approval-blocked-while-blockers-remain", blockedApproval);

const approved = recordReviewDecision(fixed, {
  status: "approved",
  rationale: "No active blockers or warnings remain in the corrected artifacts.",
  decidedBy: "U_BENCHMARK",
  decidedAt: new Date().toISOString()
});
check("human-approval-recorded-for-low-risk-review", approved.decision?.status === "approved");
check("artifact-fingerprint-created", fixed.artifactFingerprint.startsWith("sha256:"));
check(
  "decision-bound-to-artifact-fingerprint",
  approved.decision?.artifactFingerprint === fixed.artifactFingerprint
);

const drifted = compareReviewPackets(approved, reviewArtifacts({
  manifest: fixedManifest,
  mcpTools: fixedTools,
  reviewContext: { ...fixedContext, declaredFeatures: [...fixedContext.declaredFeatures, "New export feature"] }
}));
check("changed-artifact-invalidates-approval", drifted.approvalState === "stale");

check(
  "consequential-action-requires-human-review",
  bad.findings.some((finding) => finding.id === "consequential-actions-missing-human-review")
);
check(
  "official-manifest-remains-unaugmented",
  !Object.keys(fixedManifest as Record<string, unknown>).some((key) => key.startsWith("securelore_"))
);
const policyBlocked = reviewArtifacts({
  manifest: fixedManifest,
  mcpTools: fixedTools,
  reviewContext: {
    ...fixedContext,
    workspacePolicy: {
      name: "Strict agent policy",
      blockedScopes: ["im:history"],
      requiredRuntimeEvidence: ["endpoint_health"]
    }
  }
});
check(
  "workspace-policy-blocks-prohibited-scope",
  policyBlocked.findings.some((finding) => finding.id === "workspace-policy-blocked-im-history")
);
check(
  "workspace-policy-requires-runtime-proof",
  policyBlocked.findings.some((finding) => finding.id === "workspace-policy-runtime-evidence")
);
const repeatedFixed = reviewArtifacts({
  manifest: fixedManifest,
  mcpTools: fixedTools,
  reviewContext: fixedContext
});
check("artifact-fingerprint-is-deterministic", repeatedFixed.artifactFingerprint === fixed.artifactFingerprint);
check(
  "human-review-control-clears-consequential-blocker",
  !fixed.findings.some((finding) => finding.id === "consequential-actions-missing-human-review")
);
const contradictedRuntime = reviewArtifacts({
  manifest: fixedManifest,
  reviewContext: {
    ...fixedContext,
    runtimeEvidence: [{
      kind: "request_signing",
      status: "contradicted",
      description: "Unsigned requests were accepted during a production probe."
    }]
  }
});
check(
  "contradicted-runtime-proof-is-blocker",
  contradictedRuntime.findings.some(
    (finding) => finding.id === "runtime-request_signing" && finding.severity === "blocker"
  )
);
const unverifiedRuntime = reviewArtifacts({
  manifest: fixedManifest,
  reviewContext: {
    ...fixedContext,
    runtimeEvidence: [{
      kind: "endpoint_health",
      status: "not_verified",
      description: "The production endpoint has not been probed."
    }]
  }
});
check(
  "unverified-runtime-proof-is-warning",
  unverifiedRuntime.findings.some(
    (finding) => finding.id === "runtime-endpoint_health" && finding.severity === "warn"
  )
);
const reviewRequired = reviewArtifacts({
  manifest: fixedManifest,
  reviewContext: {
    ...fixedContext,
    workspacePolicy: {
      name: "Agent review policy",
      reviewRequiredScopes: ["im:history"]
    }
  }
});
check(
  "workspace-policy-flags-review-required-scope",
  reviewRequired.findings.some((finding) => finding.id === "workspace-policy-review-im-history")
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

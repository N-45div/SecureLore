import { randomUUID } from "node:crypto";
import type {
  EvidenceAssessment,
  Finding,
  McpToolReview,
  McpToolsListLike,
  RecommendedAction,
  ReviewPacket,
  PolicyContext,
  ScopeJustification,
  SlackManifestLike
} from "./types.js";

export function applyEvidenceAssessment(
  packet: ReviewPacket,
  findingId: string,
  assessment: EvidenceAssessment
): ReviewPacket {
  const target = packet.findings.find((finding) => finding.id === findingId);
  if (!target) throw new Error(`Finding ${findingId} was not found.`);

  const canResolve = target.fixability === "needs_clarification";
  const resolved = assessment.decision === "sufficient" && canResolve;
  const findings = packet.findings.map((finding) => finding.id === findingId
    ? {
        ...finding,
        resolution: {
          status: resolved ? "resolved" as const : "evidence_submitted" as const,
          rationale: canResolve
            ? assessment.rationale
            : "This finding requires corrected artifacts and cannot be resolved by narrative evidence alone.",
          evaluatedBy: assessment.evaluatedBy,
          evaluatedAt: assessment.evaluatedAt
        }
      }
    : finding);
  const grade = computeRiskGrade(findings);

  return {
    ...packet,
    findings,
    overallRisk: {
      grade,
      summary: summarizeRisk(grade, findings)
    },
    scopeJustifications: packet.scopeJustifications?.map((scope) =>
      findingId === `scope-${scope.scope.replace(/[^a-z0-9]/gi, "-")}` && resolved
        ? {
            ...scope,
            status: "justified" as const,
            recommendation: "Evidence accepted. Keep the declared use and controls aligned with the tested workflow."
          }
        : scope
    ),
    generatedArtifacts: packet.generatedArtifacts?.map((artifact) =>
      artifact.type === "admin_approval_brief"
        ? { ...artifact, content: generateAdminBrief(grade, findings) }
        : artifact
    )
  };
}

export function compareReviewPackets(previous: ReviewPacket, current: ReviewPacket): ReviewPacket {
  const previousActive = new Set(activeFindings(previous.findings).map((finding) => finding.id));
  const currentActive = new Set(activeFindings(current.findings).map((finding) => finding.id));
  const resolvedFindingIds = [...previousActive].filter((id) => !currentActive.has(id));
  const remainingFindingIds = [...currentActive].filter((id) => previousActive.has(id));
  const newFindingIds = [...currentActive].filter((id) => !previousActive.has(id));
  const comparison = {
    beforeGrade: previous.overallRisk.grade,
    afterGrade: current.overallRisk.grade,
    resolvedFindingIds,
    remainingFindingIds,
    newFindingIds
  };

  return {
    ...current,
    lineage: { parentReviewId: previous.reviewId },
    comparison,
    generatedArtifacts: [
      ...(current.generatedArtifacts ?? []),
      {
        type: "review_comparison",
        title: "Corrected artifact comparison",
        content: comparison
      }
    ]
  };
}

const BROAD_HISTORY_SCOPES = new Set([
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history"
]);

const SENSITIVE_SCOPES = new Set([
  "files:read",
  "users:read.email",
  "admin.users.info",
  "groups:write"
]);

const WRITE_KEYWORDS = [
  "create",
  "update",
  "delete",
  "archive",
  "send",
  "post",
  "submit",
  "execute",
  "trigger"
];

const READ_KEYWORDS = ["get", "list", "read", "fetch", "search", "lookup"];

export interface ReviewInput {
  manifest?: SlackManifestLike;
  mcpTools?: McpToolsListLike;
  fixtureIds?: string[];
  policyContext?: PolicyContext[];
}

export function reviewArtifacts(input: ReviewInput): ReviewPacket {
  const findings: Finding[] = [];
  const recommendedActions: RecommendedAction[] = [];
  const scopeJustifications: ScopeJustification[] = [];
  const mcpToolReviews: McpToolReview[] = [];

  const declaredFeatures = input.manifest?.securelore_declared_features ?? [];
  const artifactTypes: ReviewPacket["inputSummary"]["artifactTypes"] = [];

  if (input.manifest) {
    artifactTypes.push("slack_manifest");
    const manifestReview = reviewManifest(input.manifest, declaredFeatures);
    findings.push(...manifestReview.findings);
    recommendedActions.push(...manifestReview.recommendedActions);
    scopeJustifications.push(...manifestReview.scopeJustifications);
  }

  if (input.mcpTools) {
    artifactTypes.push("mcp_tools");
    const toolReview = reviewMcpTools(input.mcpTools);
    findings.push(...toolReview.findings);
    recommendedActions.push(...toolReview.recommendedActions);
    mcpToolReviews.push(...toolReview.mcpToolReviews);
  }

  const grade = computeRiskGrade(findings);

  return {
    packetVersion: "phase1",
    reviewId: `review-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    inputSummary: {
      artifactTypes,
      declaredFeatures,
      missingArtifacts: findMissingArtifacts(input.manifest)
    },
    overallRisk: {
      grade,
      summary: summarizeRisk(grade, findings)
    },
    findings,
    scopeJustifications,
    mcpToolReviews,
    recommendedActions: dedupeActions(recommendedActions),
    policyContext: input.policyContext ?? [],
    generatedArtifacts: [
      {
        type: "admin_approval_brief",
        title: "Admin approval brief",
        content: generateAdminBrief(grade, findings)
      },
      {
        type: "scope_justification_table",
        title: "Scope justification table",
        content: scopeJustifications
      },
      {
        type: "mcp_tool_metadata",
        title: "MCP metadata recommendations",
        content: mcpToolReviews.map((review) => ({
          toolName: review.toolName,
          classification: review.classification,
          readOnlyHintStatus: review.readOnlyHintStatus,
          issues: review.issues,
          recommendedMetadata: review.recommendedMetadata
        }))
      },
      {
        type: "marketplace_checklist",
        title: "Marketplace readiness checklist",
        content: generateMarketplaceChecklist(input.manifest, findings)
      },
      {
        type: "manifest_patch_plan",
        title: "Safer manifest patch plan",
        content: generateManifestPatchPlan(input.manifest, findings, scopeJustifications)
      }
    ],
    evalTrace: {
      fixtureIds: input.fixtureIds ?? [],
      checks: [
        {
          name: "structured_review_packet_created",
          status: "pass"
        }
      ]
    }
  };
}

function reviewManifest(
  manifest: SlackManifestLike,
  declaredFeatures: string[]
): {
  findings: Finding[];
  recommendedActions: RecommendedAction[];
  scopeJustifications: ScopeJustification[];
} {
  const findings: Finding[] = [];
  const recommendedActions: RecommendedAction[] = [];
  const scopeJustifications: ScopeJustification[] = [];
  const botScopes = manifest.oauth_config?.scopes?.bot ?? [];
  const userScopes = manifest.oauth_config?.scopes?.user ?? [];
  const allScopes = [...botScopes, ...userScopes];
  const featureText = declaredFeatures.join(" ").toLowerCase();

  for (const scope of allScopes) {
    if (BROAD_HISTORY_SCOPES.has(scope)) {
      const hasContextFeature =
        featureText.includes("summarize") ||
        featureText.includes("search") ||
        featureText.includes("context");

      findings.push({
        id: `scope-${scope.replace(/[^a-z0-9]/gi, "-")}`,
        severity: hasContextFeature ? "warn" : "blocker",
        category: "oauth_scope_risk",
        title: `Broad history scope requested: ${scope}`,
        description: hasContextFeature
          ? `${scope} may be justified, but the app needs tested access controls and a precise explanation for why broad message history is required.`
          : `${scope} provides broad message history access without a declared feature that clearly requires it.`,
        evidence: [scope],
        policyCitations: ["slack-marketplace.scope-data-access"],
        confidence: "high",
        fixability: hasContextFeature ? "needs_clarification" : "automatic"
      });
      scopeJustifications.push({
        scope,
        status: hasContextFeature ? "missing_evidence" : "remove",
        declaredUse: declaredFeatures.join("; ") || "No declared feature",
        recommendation: hasContextFeature
          ? "Provide a tested Real-Time Search or MCP use case, access controls, and retention explanation."
          : "Remove this scope until a tested feature requires broad message history."
      });
    } else if (SENSITIVE_SCOPES.has(scope)) {
      findings.push({
        id: `scope-${scope.replace(/[^a-z0-9]/gi, "-")}`,
        severity: "warn",
        category: "oauth_scope_risk",
        title: `Sensitive scope needs evidence: ${scope}`,
        description: `${scope} may be valid for some apps, but the submitted feature list does not fully explain why it is needed.`,
        evidence: [scope],
        policyCitations: ["slack-marketplace.scope-data-access"],
        confidence: "medium",
        fixability: "needs_clarification"
      });
      scopeJustifications.push({
        scope,
        status: "missing_evidence",
        declaredUse: declaredFeatures.join("; ") || "No declared feature",
        recommendation: "Document the exact user-visible feature that requires this scope, or remove it."
      });
    } else {
      scopeJustifications.push({
        scope,
        status: "justified",
        declaredUse: declaredFeatures.join("; ") || "Core Slack app behavior",
        recommendation: "Keep this scope if it maps to a tested workflow."
      });
    }
  }

  if (userScopes.length > 0) {
    findings.push({
      id: "user-token-scopes-present",
      severity: "warn",
      category: "oauth_scope_risk",
      title: "User token scopes require extra justification",
      description:
        "User token scopes should only be used when the app must act from a user's perspective and bot token scopes are insufficient.",
      evidence: userScopes,
      policyCitations: ["slack-marketplace.scope-data-access"],
      confidence: "high",
      fixability: "needs_clarification"
    });
  }

  const insecureUrls = collectManifestUrls(manifest).filter((url) =>
    url.startsWith("http://")
  );
  if (insecureUrls.length > 0) {
    findings.push({
      id: "insecure-slack-endpoints",
      severity: "blocker",
      category: "deployment_security",
      title: "Slack endpoints must use production HTTPS URLs",
      description:
        "Slack request URLs should be deployed over HTTPS. Localhost and plain HTTP endpoints are not production reviewable.",
      evidence: insecureUrls,
      policyCitations: ["slack-marketplace.security-tls"],
      confidence: "high",
      fixability: "automatic"
    });
    recommendedActions.push({
      id: "replace-insecure-urls",
      label: "Replace local HTTP endpoints",
      priority: "now",
      description: "Deploy the Slack backend and update all command, event, and interactivity URLs to HTTPS."
    });
  }

  const missingArtifacts = findMissingArtifacts(manifest);
  if (missingArtifacts.length > 0) {
    findings.push({
      id: "missing-public-pages",
      severity: "blocker",
      category: "marketplace_readiness",
      title: "Public submission pages are missing",
      description:
        "The app needs public landing, privacy, and support pages before it can be reviewed like a production Slack app.",
      evidence: missingArtifacts,
      policyCitations: ["slack-marketplace.public-pages"],
      confidence: "high",
      fixability: "manual"
    });
    recommendedActions.push({
      id: "create-public-pages",
      label: "Create public app pages",
      priority: "before_submission",
      description: "Create a public landing page, privacy policy, and support page with clear install and support paths."
    });
  }

  const aiDisclosure = manifest.securelore_ai_disclosure;
  const aiDisclosureFields: Array<[string, string | undefined]> = [
    ["model", aiDisclosure?.model],
    ["retention", aiDisclosure?.retention],
    ["training use", aiDisclosure?.training_use]
  ];
  const missingAiFields = aiDisclosureFields
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missingAiFields.length > 0) {
    findings.push({
      id: "missing-ai-disclosure",
      severity: "blocker",
      category: "ai_disclosure",
      title: "AI disclosure is incomplete",
      description:
        "The app should disclose the model/provider, data retention behavior, and whether Slack data is used for training.",
      evidence: missingAiFields,
      policyCitations: ["slack-marketplace.ai-components"],
      confidence: "high",
      fixability: "manual"
    });
    recommendedActions.push({
      id: "complete-ai-disclosure",
      label: "Complete AI disclosure",
      priority: "before_submission",
      description: "Document model use, retention, and no-training behavior in the app description and privacy policy."
    });
  }

  return { findings, recommendedActions, scopeJustifications };
}

function reviewMcpTools(toolsList: McpToolsListLike): {
  findings: Finding[];
  recommendedActions: RecommendedAction[];
  mcpToolReviews: McpToolReview[];
} {
  const findings: Finding[] = [];
  const recommendedActions: RecommendedAction[] = [];
  const mcpToolReviews: McpToolReview[] = [];

  for (const tool of toolsList.tools ?? []) {
    const name = tool.name ?? "unnamed_tool";
    const text = `${tool.name ?? ""} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
    const isWrite = WRITE_KEYWORDS.some((keyword) => text.includes(keyword));
    const isRead = READ_KEYWORDS.some((keyword) => text.includes(keyword));
    const classification = isWrite ? "write" : isRead ? "read" : "ambiguous";
    const hasSchema =
      typeof tool.inputSchema === "object" &&
      tool.inputSchema !== null &&
      Object.keys(tool.inputSchema).length > 1;
    const readOnlyHint = tool.annotations?.readOnlyHint;
    const issues: string[] = [];

    if (!hasSchema) {
      issues.push("Tool is missing a specific input schema.");
    }
    if (classification === "ambiguous") {
      issues.push("Tool behavior is ambiguous from its name, title, and description.");
    }
    if (readOnlyHint === undefined) {
      issues.push("Tool is missing readOnlyHint.");
    }
    if (classification === "write" && readOnlyHint === true) {
      issues.push("Tool appears to mutate state but is marked read-only.");
    }

    const readOnlyHintStatus: McpToolReview["readOnlyHintStatus"] =
      readOnlyHint === undefined
        ? "missing"
        : classification === "write" && readOnlyHint === true
          ? "present_invalid"
          : "present_valid";

    mcpToolReviews.push({
      toolName: name,
      classification,
      readOnlyHintStatus,
      issues,
      recommendedMetadata: buildRecommendedToolMetadata(name, classification)
    });

    if (issues.length > 0) {
      findings.push({
        id: `mcp-${name.replace(/[^a-z0-9]/gi, "-")}`,
        severity:
          classification === "write" || classification === "ambiguous"
            ? "blocker"
            : "warn",
        category: "mcp_tool_safety",
        title: `MCP tool needs review: ${name}`,
        description: issues.join(" "),
        evidence: [name],
        policyCitations: ["slack-mcp.tool-discovery"],
        confidence: "high",
        fixability: "automatic"
      });
    }
  }

  if (findings.length > 0) {
    recommendedActions.push({
      id: "fix-mcp-tool-metadata",
      label: "Fix MCP tool metadata",
      priority: "now",
      description:
        "Rename vague tools, add specific input schemas, and align readOnlyHint with actual tool behavior."
    });
  }

  return { findings, recommendedActions, mcpToolReviews };
}

function collectManifestUrls(manifest: SlackManifestLike): string[] {
  const urls: string[] = [];
  for (const command of manifest.features?.slash_commands ?? []) {
    if (command.url) urls.push(command.url);
  }
  if (manifest.settings?.event_subscriptions?.request_url) {
    urls.push(manifest.settings.event_subscriptions.request_url);
  }
  if (manifest.settings?.interactivity?.request_url) {
    urls.push(manifest.settings.interactivity.request_url);
  }
  return urls;
}

function findMissingArtifacts(manifest?: SlackManifestLike): string[] {
  if (!manifest) return [];
  const pages = manifest.securelore_public_pages;
  const missing: string[] = [];
  if (!pages?.landing_page_url) missing.push("landing page");
  if (!pages?.privacy_policy_url) missing.push("privacy policy");
  if (!pages?.support_page_url) missing.push("support page");
  return missing;
}

function computeRiskGrade(findings: Finding[]): ReviewPacket["overallRisk"]["grade"] {
  const active = activeFindings(findings);
  const blockerCount = active.filter((finding) => finding.severity === "blocker").length;
  const warnCount = active.filter((finding) => finding.severity === "warn").length;
  if (blockerCount >= 4) return "reject";
  if (blockerCount > 0) return "high";
  if (warnCount > 0) return "medium";
  return "low";
}

function summarizeRisk(
  grade: ReviewPacket["overallRisk"]["grade"],
  findings: Finding[]
): string {
  const active = activeFindings(findings);
  const blockers = active.filter((finding) => finding.severity === "blocker").length;
  const warnings = active.filter((finding) => finding.severity === "warn").length;
  const resolved = findings.length - active.length;
  if (grade === "low") return "No blocking issues were found in the submitted artifacts.";
  return `${blockers} blocker(s) and ${warnings} warning(s) remain${resolved ? `; ${resolved} finding(s) resolved by evidence` : ""}. Address blockers before submitting or asking admins to approve the app.`;
}

function activeFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) =>
    finding.resolution?.status !== "resolved" && finding.resolution?.status !== "accepted_risk"
  );
}

function dedupeActions(actions: RecommendedAction[]): RecommendedAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

function generateAdminBrief(
  grade: ReviewPacket["overallRisk"]["grade"],
  findings: Finding[]
): string {
  const active = activeFindings(findings);
  const blockers = active.filter((finding) => finding.severity === "blocker");
  const warnings = active.filter((finding) => finding.severity === "warn");
  const resolved = findings.filter((finding) => finding.resolution?.status === "resolved");
  return [
    `SecureLore risk grade: ${grade.toUpperCase()}.`,
    blockers.length > 0
      ? `Blockers: ${blockers.map((finding) => finding.title).join("; ")}.`
      : "No blockers found.",
    warnings.length > 0
      ? `Warnings: ${warnings.map((finding) => finding.title).join("; ")}.`
      : "No warnings found.",
    resolved.length > 0
      ? `Resolved by reviewed evidence: ${resolved.map((finding) => finding.title).join("; ")}.`
      : "No findings have been resolved by evidence.",
    "Admin recommendation: approve only after blockers are resolved and remaining sensitive scopes are mapped to tested user-visible features."
  ].join(" ");
}

function buildRecommendedToolMetadata(
  name: string,
  classification: McpToolReview["classification"]
): Record<string, unknown> {
  return {
    name,
    annotations: {
      readOnlyHint: classification === "read"
    },
    note:
      classification === "ambiguous"
        ? "Rename this tool and describe whether it reads data or performs an external action."
        : "Ensure the title, description, and schema match the actual tool behavior."
  };
}

function generateMarketplaceChecklist(
  manifest: SlackManifestLike | undefined,
  findings: Finding[]
): Array<{
  item: string;
  status: "pass" | "blocked" | "needs_evidence" | "not_submitted";
  evidence: string;
  nextAction: string;
}> {
  if (!manifest) {
    return [
      {
        item: "Slack app manifest",
        status: "not_submitted",
        evidence: "No Slack manifest was included in this review.",
        nextAction: "Submit a real Slack app manifest to evaluate Marketplace readiness."
      }
    ];
  }

  const findingIds = new Set(findings.map((finding) => finding.id));
  const hasWarnScopes = findings.some(
    (finding) => finding.category === "oauth_scope_risk" && finding.severity === "warn"
  );
  const hasBlockerScopes = findings.some(
    (finding) => finding.category === "oauth_scope_risk" && finding.severity === "blocker"
  );
  const urls = collectManifestUrls(manifest);
  const httpsUrls = urls.filter((url) => url.startsWith("https://"));
  const missingPages = findMissingArtifacts(manifest);
  const aiDisclosure = manifest.securelore_ai_disclosure;

  return [
    {
      item: "Production HTTPS Slack endpoints",
      status: findingIds.has("insecure-slack-endpoints") ? "blocked" : "pass",
      evidence:
        urls.length === 0
          ? "No command/event/action URLs were found."
          : `${httpsUrls.length}/${urls.length} endpoint(s) use HTTPS.`,
      nextAction: findingIds.has("insecure-slack-endpoints")
        ? "Replace every http:// Slack request URL with a deployed https:// URL."
        : "Keep production URLs stable for judging and admin testing."
    },
    {
      item: "Least-privilege scope review",
      status: hasBlockerScopes ? "blocked" : hasWarnScopes ? "needs_evidence" : "pass",
      evidence: findings
        .filter((finding) => finding.category === "oauth_scope_risk")
        .map((finding) => finding.title)
        .join("; ") || "No scope findings were raised.",
      nextAction: hasBlockerScopes
        ? "Remove broad history scopes or document the exact tested feature and access controls."
        : hasWarnScopes
          ? "Add feature-level justification for each sensitive scope before submission."
          : "Keep scope descriptions aligned with tested user-visible workflows."
    },
    {
      item: "Public landing, privacy, and support pages",
      status: missingPages.length > 0 ? "blocked" : "pass",
      evidence: missingPages.length > 0 ? `Missing: ${missingPages.join(", ")}.` : "All public page URLs are declared.",
      nextAction: missingPages.length > 0
        ? "Publish public app pages and add their URLs to securelore_public_pages."
        : "Verify all public pages are accessible without login."
    },
    {
      item: "AI disclosure",
      status: findingIds.has("missing-ai-disclosure") ? "blocked" : "pass",
      evidence: aiDisclosure
        ? `model=${aiDisclosure.model ?? "missing"}, retention=${aiDisclosure.retention ?? "missing"}, training_use=${aiDisclosure.training_use ?? "missing"}`
        : "No AI disclosure object was declared.",
      nextAction: findingIds.has("missing-ai-disclosure")
        ? "Declare model/provider, retention, and no-training behavior in the app listing and privacy policy."
        : "Keep AI disclosure consistent across manifest, landing page, and demo."
    },
    {
      item: "Admin approval packet",
      status: findings.some((finding) => finding.severity === "blocker") ? "blocked" : "pass",
      evidence: `${findings.filter((finding) => finding.severity === "blocker").length} blocker(s), ${findings.filter((finding) => finding.severity === "warn").length} warning(s).`,
      nextAction: "Use the admin brief and scope table artifacts as the approval handoff."
    }
  ];
}

function generateManifestPatchPlan(
  manifest: SlackManifestLike | undefined,
  findings: Finding[],
  scopeJustifications: ScopeJustification[]
): Array<{
  path: string;
  current?: unknown;
  suggested?: unknown;
  reason: string;
}> {
  if (!manifest) return [];

  const patches: Array<{
    path: string;
    current?: unknown;
    suggested?: unknown;
    reason: string;
  }> = [];

  for (const [index, command] of (manifest.features?.slash_commands ?? []).entries()) {
    if (command.url?.startsWith("http://")) {
      patches.push({
        path: `features.slash_commands[${index}].url`,
        current: command.url,
        suggested: toProductionHttpsPlaceholder(command.url),
        reason: "Slack Marketplace review requires production HTTPS endpoints."
      });
    }
  }

  const eventUrl = manifest.settings?.event_subscriptions?.request_url;
  if (eventUrl?.startsWith("http://")) {
    patches.push({
      path: "settings.event_subscriptions.request_url",
      current: eventUrl,
      suggested: toProductionHttpsPlaceholder(eventUrl),
      reason: "Event subscriptions must use deployed HTTPS URLs."
    });
  }

  const actionUrl = manifest.settings?.interactivity?.request_url;
  if (actionUrl?.startsWith("http://")) {
    patches.push({
      path: "settings.interactivity.request_url",
      current: actionUrl,
      suggested: toProductionHttpsPlaceholder(actionUrl),
      reason: "Interactivity actions must use deployed HTTPS URLs."
    });
  }

  const removableScopes = scopeJustifications
    .filter((scope) => scope.status === "remove")
    .map((scope) => scope.scope);
  if (removableScopes.length > 0) {
    const currentScopes = manifest.oauth_config?.scopes?.bot ?? [];
    patches.push({
      path: "oauth_config.scopes.bot",
      current: currentScopes,
      suggested: currentScopes.filter((scope) => !removableScopes.includes(scope)),
      reason: "Remove broad scopes that lack a declared tested feature."
    });
  }

  if (findMissingArtifacts(manifest).length > 0) {
    patches.push({
      path: "securelore_public_pages",
      current: manifest.securelore_public_pages ?? null,
      suggested: {
        landing_page_url: "https://<your-public-app-page>",
        privacy_policy_url: "https://<your-public-privacy-policy>",
        support_page_url: "https://<your-public-support-page>"
      },
      reason: "Marketplace-style review requires public landing, privacy, and support pages."
    });
  }

  if (findings.some((finding) => finding.id === "missing-ai-disclosure")) {
    patches.push({
      path: "securelore_ai_disclosure",
      current: manifest.securelore_ai_disclosure ?? null,
      suggested: {
        model: "<provider/model>",
        retention: "<retention behavior>",
        training_use: "Slack data is not used to train LLMs"
      },
      reason: "AI apps should disclose model use, retention, and no-training behavior."
    });
  }

  return patches;
}

function toProductionHttpsPlaceholder(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://<production-host>${parsed.pathname}`;
  } catch {
    return "https://<production-host>/<slack-endpoint>";
  }
}

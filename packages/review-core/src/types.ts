export type ArtifactType =
  | "slack_manifest"
  | "oauth_scopes"
  | "mcp_tools"
  | "landing_page"
  | "privacy_policy"
  | "support_page"
  | "marketplace_description"
  | "repo"
  | "demo_transcript";

export type Severity = "pass" | "info" | "warn" | "blocker";

export type FindingCategory =
  | "oauth_scope_risk"
  | "mcp_tool_safety"
  | "marketplace_readiness"
  | "ai_disclosure"
  | "slack_privacy_model"
  | "ux_admin_trust"
  | "deployment_security";

export interface Finding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  description: string;
  evidence?: string[];
  policyCitations?: string[];
  confidence: "low" | "medium" | "high";
  fixability: "manual" | "automatic" | "needs_clarification";
  resolution?: {
    status: "evidence_submitted" | "resolved" | "accepted_risk";
    rationale: string;
    evaluatedBy: string;
    evaluatedAt: string;
    quality?: {
      relevance: number;
      specificity: number;
      testability: number;
      policyAlignment: number;
    };
  };
}

export interface EvidenceAssessment {
  decision: "sufficient" | "insufficient" | "not_evaluated";
  rationale: string;
  evaluatedBy: string;
  evaluatedAt: string;
  quality?: {
    relevance: number;
    specificity: number;
    testability: number;
    policyAlignment: number;
  };
}

export interface ReviewDecisionInput {
  status: "approved" | "changes_requested" | "warnings_accepted";
  rationale: string;
  decidedBy: string;
  decidedAt: string;
  artifactFingerprint?: string;
}

export interface ReviewContext {
  declaredFeatures: string[];
  publicPages?: {
    landingPageUrl?: string;
    privacyPolicyUrl?: string;
    supportPageUrl?: string;
  };
  aiDisclosure?: {
    model?: string;
    retention?: string;
    trainingUse?: string;
  };
  scopeJustifications?: Record<string, string>;
  consequentialActions?: string[];
  humanReviewControls?: string;
  runtimeEvidence?: Array<{
    kind: "endpoint_health" | "request_signing" | "scope_feature_test" | "mcp_action_guard" | "retention_control" | "other";
    status: "declared" | "verified" | "not_verified" | "contradicted";
    description: string;
    reference?: string;
  }>;
  workspacePolicy?: {
    name: string;
    blockedScopes?: string[];
    reviewRequiredScopes?: string[];
    requiredRuntimeEvidence?: Array<
      "endpoint_health" | "request_signing" | "scope_feature_test" | "mcp_action_guard" | "retention_control" | "other"
    >;
  };
}

export interface ScopeJustification {
  scope: string;
  status: "justified" | "overbroad" | "missing_evidence" | "remove";
  declaredUse: string;
  recommendation: string;
}

export interface McpToolReview {
  toolName: string;
  classification: "read" | "write" | "ambiguous";
  readOnlyHintStatus:
    | "present_valid"
    | "present_invalid"
    | "missing"
    | "not_applicable";
  issues: string[];
  recommendedMetadata?: Record<string, unknown>;
}

export interface RecommendedAction {
  id: string;
  label: string;
  priority: "now" | "before_submission" | "before_marketplace" | "later";
  description: string;
}

export interface GeneratedArtifact {
  type:
    | "manifest_diff"
    | "fixed_manifest"
    | "scope_justification_table"
    | "marketplace_notes"
    | "marketplace_checklist"
    | "privacy_disclosure"
    | "ai_disclosure"
    | "admin_approval_brief"
    | "manifest_patch_plan"
    | "mcp_tool_metadata"
    | "review_comparison";
  title: string;
  content: string | Record<string, unknown> | unknown[];
}

export interface PolicyContext {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  similarity?: number;
  excerpt: string;
  tags?: string[];
}

export interface ReviewPacket {
  packetVersion: "phase1";
  reviewId: string;
  createdAt: string;
  artifactFingerprint: string;
  inputSummary: {
    artifactTypes: ArtifactType[];
    declaredFeatures: string[];
    missingArtifacts?: string[];
    reviewContext?: ReviewContext;
  };
  overallRisk: {
    grade: "low" | "medium" | "high" | "reject";
    summary: string;
  };
  findings: Finding[];
  scopeJustifications?: ScopeJustification[];
  mcpToolReviews?: McpToolReview[];
  recommendedActions: RecommendedAction[];
  policyContext?: PolicyContext[];
  generatedArtifacts?: GeneratedArtifact[];
  lineage?: {
    parentReviewId: string;
    parentArtifactFingerprint?: string;
  };
  comparison?: {
    beforeGrade: "low" | "medium" | "high" | "reject";
    afterGrade: "low" | "medium" | "high" | "reject";
    resolvedFindingIds: string[];
    remainingFindingIds: string[];
    newFindingIds: string[];
  };
  decision?: ReviewDecisionInput;
  approvalState?: "pending" | "changes_requested" | "approved" | "warnings_accepted" | "stale";
  evalTrace?: {
    fixtureIds?: string[];
    checks?: Array<{
      name: string;
      status: "pass" | "fail" | "not_run";
      notes?: string;
    }>;
  };
}

export interface SlackManifestLike {
  display_information?: {
    name?: string;
    description?: string;
  };
  features?: {
    slash_commands?: Array<{
      command?: string;
      url?: string;
      description?: string;
      usage_hint?: string;
    }>;
    app_home?: {
      home_tab_enabled?: boolean;
      messages_tab_enabled?: boolean;
    };
  };
  oauth_config?: {
    scopes?: {
      bot?: string[];
      user?: string[];
    };
  };
  settings?: {
    event_subscriptions?: {
      request_url?: string;
      bot_events?: string[];
    };
    interactivity?: {
      request_url?: string;
    };
    org_deploy_enabled?: boolean;
    token_rotation_enabled?: boolean;
  };
}

export interface McpToolsListLike {
  tools?: Array<{
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: {
      readOnlyHint?: boolean;
    };
  }>;
}

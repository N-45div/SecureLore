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
    | "privacy_disclosure"
    | "ai_disclosure"
    | "admin_approval_brief"
    | "mcp_tool_metadata";
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
  inputSummary: {
    artifactTypes: ArtifactType[];
    declaredFeatures: string[];
    missingArtifacts?: string[];
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
  securelore_declared_features?: string[];
  securelore_public_pages?: {
    landing_page_url?: string;
    privacy_policy_url?: string;
    support_page_url?: string;
  };
  securelore_ai_disclosure?: {
    model?: string;
    retention?: string;
    training_use?: string;
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

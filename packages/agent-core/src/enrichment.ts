import type {
  EvidenceAssessment,
  Finding,
  GeneratedArtifact,
  PolicyContext,
  ReviewPacket
} from "@securelore/review-core";
import { completeJson } from "./openrouter.js";

export interface EnrichmentOptions {
  openRouterApiKey?: string;
  model?: string;
}

interface EnrichmentResponse {
  critique: string;
  marketplaceNotes: string;
  privacyDisclosure: string;
  aiDisclosure: string;
  reviewerQuestions: string[];
}

interface EvidenceAssessmentResponse {
  decision: "sufficient" | "insufficient";
  rationale: string;
  quality?: {
    relevance?: number;
    specificity?: number;
    testability?: number;
    policyAlignment?: number;
  };
}

export async function evaluateFindingEvidence(
  finding: Finding,
  evidence: string,
  policyContext: PolicyContext[] = [],
  options: EnrichmentOptions = {}
): Promise<EvidenceAssessment> {
  const evaluatedAt = new Date().toISOString();
  if (finding.fixability !== "needs_clarification") {
    return {
      decision: "insufficient",
      rationale: "This finding requires corrected artifacts and cannot be resolved by narrative evidence.",
      evaluatedBy: "securelore-deterministic-guard",
      evaluatedAt
    };
  }
  if (!options.openRouterApiKey) {
    return {
      decision: "not_evaluated",
      rationale: "Evidence was captured but model-assisted evaluation is unavailable.",
      evaluatedBy: "securelore-agent",
      evaluatedAt
    };
  }

  const result = await completeJson<EvidenceAssessmentResponse>(
    [
      {
        role: "system",
        content: [
          "You evaluate evidence for one Slack app review finding.",
          "Accept only concrete, testable evidence that directly answers the finding.",
          "A feature claim without controls, behavior, or verification is insufficient.",
          "Score evidence quality from 0 to 5 for relevance, specificity, testability, and policyAlignment.",
          "Do not override Slack policy and do not resolve artifact-fix findings.",
          "Return strict JSON with decision sufficient or insufficient and a concise rationale."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          finding,
          evidence,
          policyContext: policyContext.slice(0, 6).map((policy) => ({
            id: policy.id,
            excerpt: policy.excerpt.slice(0, 700)
          }))
        })
      }
    ],
    {
      apiKey: options.openRouterApiKey,
      model: options.model
    }
  );

  return {
    decision: result.decision === "sufficient" ? "sufficient" : "insufficient",
    rationale: result.rationale,
    evaluatedBy: "securelore-agent",
    evaluatedAt,
    quality: normalizeEvidenceQuality(result.quality)
  };
}

function normalizeEvidenceQuality(value: EvidenceAssessmentResponse["quality"]): EvidenceAssessment["quality"] {
  const score = (candidate: number | undefined) =>
    Math.max(0, Math.min(5, Number.isFinite(candidate) ? Number(candidate) : 0));
  return {
    relevance: score(value?.relevance),
    specificity: score(value?.specificity),
    testability: score(value?.testability),
    policyAlignment: score(value?.policyAlignment)
  };
}

export async function enrichReviewPacket(
  packet: ReviewPacket,
  options: EnrichmentOptions = {}
): Promise<ReviewPacket> {
  if (!options.openRouterApiKey) {
    return {
      ...packet,
      evalTrace: {
        ...packet.evalTrace,
        checks: [
          ...(packet.evalTrace?.checks ?? []),
          {
            name: "eve_openrouter_enrichment",
            status: "not_run",
            notes: "OPENROUTER_API_KEY is not configured."
          }
        ]
      }
    };
  }

  const enrichment = await completeJson<EnrichmentResponse>(
    [
      {
        role: "system",
        content: [
          "You are SecureLore's Eve review agent.",
          "You enrich deterministic Slack app and MCP safety reviews.",
          "Do not invent Slack policy. Use supplied policyContext IDs when applicable.",
          "Return strict JSON with keys: critique, marketplaceNotes, privacyDisclosure, aiDisclosure, reviewerQuestions.",
          "Keep text concise and directly usable in Slack."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          overallRisk: packet.overallRisk,
          findings: packet.findings.slice(0, 20),
          scopeJustifications: packet.scopeJustifications?.slice(0, 20),
          mcpToolReviews: packet.mcpToolReviews?.slice(0, 20),
          policyContext: packet.policyContext?.map((policy) => ({
            id: policy.id,
            title: policy.title,
            excerpt: policy.excerpt.slice(0, 700)
          }))
        })
      }
    ],
    {
      apiKey: options.openRouterApiKey,
      model: options.model
    }
  );

  const generatedArtifacts: GeneratedArtifact[] = [
    ...(packet.generatedArtifacts ?? []),
    {
      type: "marketplace_notes",
      title: "Marketplace review notes",
      content: enrichment.marketplaceNotes
    },
    {
      type: "privacy_disclosure",
      title: "Privacy disclosure draft",
      content: enrichment.privacyDisclosure
    },
    {
      type: "ai_disclosure",
      title: "AI disclosure draft",
      content: enrichment.aiDisclosure
    }
  ];

  return {
    ...packet,
    generatedArtifacts,
    recommendedActions: [
      ...packet.recommendedActions,
      {
        id: "review-eve-questions",
        label: "Review Eve follow-up questions",
        priority: "before_submission",
        description: enrichment.reviewerQuestions.join(" ")
      }
    ],
    evalTrace: {
      ...packet.evalTrace,
      checks: [
        ...(packet.evalTrace?.checks ?? []),
        {
          name: "eve_openrouter_enrichment",
          status: "pass",
          notes: enrichment.critique
        }
      ]
    }
  };
}

import type { GeneratedArtifact, ReviewPacket } from "@securelore/review-core";
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

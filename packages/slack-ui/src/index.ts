import type { GeneratedArtifact, ReviewPacket, Severity } from "@securelore/review-core";

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface ReviewHomeSummary {
  id: string;
  grade: string;
  summary: string;
  blockerCount: number;
  warningCount: number;
  evidenceCount: number;
  artifactTypes: string[];
  decisionStatus?: string;
  approvalState?: string;
  artifactFingerprint?: string;
  createdAt: string;
}

export interface ReviewEvidenceSummary {
  questionId?: string;
  evidence: string;
  createdAt: string;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  pass: "PASS",
  info: "INFO",
  warn: "WARN",
  blocker: "BLOCKER"
};

export function renderReviewPacket(packet: ReviewPacket): SlackBlock[] {
  const topFindings = packet.findings
    .filter((finding) =>
      (finding.severity === "blocker" || finding.severity === "warn") &&
      finding.resolution?.status !== "resolved" &&
      finding.resolution?.status !== "accepted_risk"
    )
    .slice(0, 8);

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `SecureLore review: ${packet.overallRisk.grade.toUpperCase()}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: packet.overallRisk.summary
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Artifacts: ${packet.inputSummary.artifactTypes.join(", ") || "none"} • Fingerprint: ${shortFingerprint(packet.artifactFingerprint)}`
        }
      ]
    }
  ];

  if (packet.policyContext && packet.policyContext.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Policy memory used*\n${packet.policyContext
          .slice(0, 3)
          .map((policy) => `• ${policy.title} (${policy.sourceUrl ?? policy.id})`)
          .join("\n")}`
      }
    });
  }

  if (packet.comparison) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Corrected artifact comparison:* ${packet.comparison.beforeGrade.toUpperCase()} → ${packet.comparison.afterGrade.toUpperCase()}`,
          `Resolved: ${packet.comparison.resolvedFindingIds.length} | Remaining: ${packet.comparison.remainingFindingIds.length} | New: ${packet.comparison.newFindingIds.length}`
        ].join("\n")
      }
    });
  }

  if (topFindings.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: topFindings
          .map(
            (finding) =>
              `*${SEVERITY_LABEL[finding.severity]}* - ${finding.title}\n${finding.description}`
          )
          .join("\n\n")
      }
    });
  }

  if (packet.recommendedActions.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Recommended next actions*\n${packet.recommendedActions
          .slice(0, 5)
          .map((action) => `• *${action.label}:* ${action.description}`)
          .join("\n")}`
      }
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Admin brief"
        },
        value: packet.reviewId,
        action_id: "artifact_admin_brief"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Scope table"
        },
        value: packet.reviewId,
        action_id: "artifact_scope_table"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "MCP metadata"
        },
        value: packet.reviewId,
        action_id: "artifact_mcp_metadata"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Checklist"
        },
        value: packet.reviewId,
        action_id: "artifact_marketplace_checklist"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Patch plan"
        },
        value: packet.reviewId,
        action_id: "artifact_manifest_patch_plan"
      }
    ]
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Good fix"
        },
        value: packet.reviewId,
        action_id: "feedback_good_fix"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Bad fix"
        },
        value: packet.reviewId,
        action_id: "feedback_bad_fix"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Missed issue"
        },
        value: packet.reviewId,
        action_id: "feedback_missed_issue"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "False alarm"
        },
        value: packet.reviewId,
        action_id: "feedback_false_alarm"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Add evidence"
        },
        value: packet.reviewId,
        action_id: "room_add_evidence"
      }
    ]
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Learning trace"
        },
        value: packet.reviewId,
        action_id: "artifact_learning_trace"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Submit corrected artifacts"
        },
        value: packet.reviewId,
        action_id: "room_submit_fix"
      }
    ]
  });

  return blocks;
}

export function renderReviewRoom(
  packet: ReviewPacket,
  evidenceCount = 0,
  evidence: ReviewEvidenceSummary[] = []
): SlackBlock[] {
  const evidenceQuestions = packet.findings
    .filter((finding) =>
      finding.fixability === "needs_clarification" && finding.resolution?.status !== "resolved"
    )
    .slice(0, 4);
  const activeFindings = packet.findings.filter((finding) =>
    finding.resolution?.status !== "resolved" && finding.resolution?.status !== "accepted_risk"
  );
  const blockers = activeFindings.filter((finding) => finding.severity === "blocker").length;
  const warnings = activeFindings.filter((finding) => finding.severity === "warn").length;
  const resolved = packet.findings.filter((finding) => finding.resolution?.status === "resolved");
  const evidenceQuestionIds = new Set(evidence.map((item) => item.questionId).filter(Boolean));
  const learnedLessons = (packet.policyContext ?? []).filter(
    (policy) => policy.source === "securelore-learning"
  );

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "SecureLore Review Room"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Status:* ${packet.overallRisk.grade === "low" ? "Ready for admin" : "Needs evidence"}`,
          `*Risk:* ${packet.overallRisk.grade.toUpperCase()} (${blockers} blocker(s), ${warnings} warning(s))`,
          `*Evidence captured:* ${evidenceCount}`,
          `*Artifact:* ${shortFingerprint(packet.artifactFingerprint)} • Approval: ${(packet.approvalState ?? "pending").replaceAll("_", " ").toUpperCase()}`
        ].join("\n")
      }
    }
  ];

  if (evidenceQuestions.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Evidence questions*\n${evidenceQuestions
          .map((finding) => {
            const status = evidenceQuestionIds.has(finding.id) ? "evidence added" : "needs answer";
            return `• *${finding.title}* - ${status}\n${finding.description}`;
          })
          .join("\n")}`
      }
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No clarification questions are open. Use the generated artifacts for admin approval."
      }
    });
  }

  if (evidence.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Latest evidence*\n${evidence
          .slice(0, 3)
          .map((item) => {
            const label = item.questionId
              ? packet.findings.find((finding) => finding.id === item.questionId)?.title ?? item.questionId
              : "General evidence";
            return `• *${label}:* ${truncateInline(item.evidence, 220)}`;
          })
          .join("\n")}`
      }
    });
  }

  if (resolved.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Resolved by evidence*\n${resolved
          .slice(0, 4)
          .map((finding) => {
            const quality = finding.resolution?.quality;
            const score = quality
              ? ` Quality ${Object.values(quality).reduce((sum, value) => sum + value, 0).toFixed(1)}/20.`
              : "";
            return `• *${finding.title}* - ${finding.resolution?.rationale ?? "Evidence accepted."}${score}`;
          })
          .join("\n")}`
      }
    });
  }

  if (learnedLessons.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Lessons used*\n${learnedLessons
          .slice(0, 3)
          .map((lesson) => `• ${truncateInline(lesson.excerpt, 180)}`)
          .join("\n")}`
      }
    });
  }

  if (packet.decision) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Human decision:* ${packet.decision.status.replaceAll("_", " ").toUpperCase()}`,
          `*Reviewer:* <@${packet.decision.decidedBy}>`,
          `*Rationale:* ${packet.decision.rationale}`
        ].join("\n")
      }
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Add evidence"
        },
        value: packet.reviewId,
        action_id: "room_add_evidence"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Promote lesson"
        },
        value: packet.reviewId,
        action_id: "room_promote_lesson"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Admin brief"
        },
        value: packet.reviewId,
        action_id: "artifact_admin_brief"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Learning trace"
        },
        value: packet.reviewId,
        action_id: "artifact_learning_trace"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Submit fix"
        },
        value: packet.reviewId,
        action_id: "room_submit_fix"
      }
    ]
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Record decision" },
        style: "primary",
        value: packet.reviewId,
        action_id: "room_record_decision"
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Request admin review" },
        value: packet.reviewId,
        action_id: "room_request_admin_review"
      }
    ]
  });

  return blocks;
}

export function renderLearningTrace(packet: ReviewPacket): SlackBlock[] {
  const lessons = (packet.policyContext ?? []).filter(
    (policy) => policy.source === "securelore-learning"
  );

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "SecureLore learning trace"
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Review ${packet.reviewId} - ${lessons.length} learned lesson(s) retrieved`
        }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lessons.length > 0
          ? lessons
              .slice(0, 5)
              .map((lesson) =>
                `• *${lesson.title}* (${formatSimilarity(lesson.similarity)})\n${truncateInline(lesson.excerpt, 420)}`
              )
              .join("\n\n")
          : "No promoted SecureLore lessons were retrieved for this review."
      }
    }
  ];
}

export function renderGeneratedArtifact(packet: ReviewPacket, artifact: GeneratedArtifact): SlackBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: artifact.title.slice(0, 150)
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Review ${packet.reviewId} - ${packet.overallRisk.grade.toUpperCase()}`
        }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: formatArtifactContent(artifact)
      }
    }
  ];
}

export function renderAdminBriefWithEvidence(
  packet: ReviewPacket,
  artifact: GeneratedArtifact,
  evidence: ReviewEvidenceSummary[]
): SlackBlock[] {
  const blocks = renderGeneratedArtifact(packet, artifact);

  if (evidence.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Submitted evidence*\n${evidence
          .slice(0, 5)
          .map((item) => {
            const label = item.questionId
              ? packet.findings.find((finding) => finding.id === item.questionId)?.title ?? item.questionId
              : "General evidence";
            return `• *${label}:* ${truncateInline(item.evidence, 260)}`;
          })
          .join("\n")}`
      }
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Submitted evidence*\nNo evidence has been attached to this review yet."
      }
    });
  }

  return blocks;
}

export function renderAppHome(
  reviews: ReviewHomeSummary[],
  options: { reviewerMode?: boolean } = {}
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "SecureLore"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: options.reviewerMode
          ? "*Admin review queue for workspace agent approvals and version-bound decisions.*"
          : "*Your Slack-native readiness dashboard for agents, MCP tools, scopes, and Marketplace evidence.*"
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Run new review"
          },
          action_id: "home_new_review"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Refresh"
          },
          action_id: "home_refresh"
        }
      ]
    },
    {
      type: "divider"
    }
  ];

  if (reviews.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No reviews yet. Run `/securelore review` to review a Slack manifest or MCP tools/list response."
      }
    });
    return blocks;
  }

  const ready = reviews.filter((review) => review.grade === "low").length;
  const openBlockers = reviews.reduce((sum, review) => sum + review.blockerCount, 0);
  const evidence = reviews.reduce((sum, review) => sum + review.evidenceCount, 0);
  const decisions = reviews.filter((review) => review.decisionStatus).length;
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Reviews in view*\n${reviews.length}` },
      { type: "mrkdwn", text: `*Ready for approval*\n${ready}` },
      { type: "mrkdwn", text: `*Open blockers*\n${openBlockers}` },
      { type: "mrkdwn", text: `*Evidence items*\n${evidence}` },
      { type: "mrkdwn", text: `*Human decisions*\n${decisions}` }
    ]
  });
  blocks.push({ type: "divider" });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Recent reviews*"
    }
  });

  for (const review of reviews.slice(0, 8)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${review.grade.toUpperCase()}* - ${formatDate(review.createdAt)}`,
          `${review.blockerCount} blocker(s), ${review.warningCount} warning(s), ${review.evidenceCount} evidence item(s)`,
          `Decision: ${review.decisionStatus?.replaceAll("_", " ") ?? "pending"}`,
          `Artifact: ${shortFingerprint(review.artifactFingerprint)} • ${review.approvalState?.replaceAll("_", " ") ?? "pending"}`,
          `Inputs: ${review.artifactTypes.join(", ") || "none"}`,
          `_${review.summary}_`
        ].join("\n")
      }
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Open room"
          },
          value: review.id,
          action_id: "home_open_room"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Add evidence"
          },
          value: review.id,
          action_id: "room_add_evidence"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Admin brief"
          },
          value: review.id,
          action_id: "artifact_admin_brief"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Patch plan"
          },
          value: review.id,
          action_id: "artifact_manifest_patch_plan"
        }
      ]
    });
  }

  return blocks;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function shortFingerprint(value?: string): string {
  return value ? `${value.slice(0, 15)}…${value.slice(-8)}` : "legacy review";
}

function formatArtifactContent(artifact: GeneratedArtifact): string {
  if (typeof artifact.content === "string") {
    return truncateForSlack(artifact.content);
  }

  if (artifact.type === "scope_justification_table" && Array.isArray(artifact.content)) {
    const rows = artifact.content
      .slice(0, 20)
      .map((row) => {
        const value = row as {
          scope?: string;
          status?: string;
          recommendation?: string;
        };
        return `• *${value.scope ?? "unknown"}* - ${value.status ?? "unknown"}\n${value.recommendation ?? ""}`;
      })
      .join("\n");
    return truncateForSlack(rows || "No scope rows were generated.");
  }

  if (artifact.type === "mcp_tool_metadata" && Array.isArray(artifact.content)) {
    const rows = artifact.content
      .slice(0, 15)
      .map((row) => {
        const value = row as {
          toolName?: string;
          classification?: string;
          readOnlyHintStatus?: string;
          issues?: string[];
        };
        return [
          `• *${value.toolName ?? "unknown"}* - ${value.classification ?? "unknown"}`,
          `readOnlyHint: ${value.readOnlyHintStatus ?? "unknown"}`,
          value.issues?.length ? `issues: ${value.issues.join("; ")}` : "issues: none"
        ].join("\n");
      })
      .join("\n");
    return truncateForSlack(rows || "No MCP metadata recommendations were generated.");
  }

  if (artifact.type === "marketplace_checklist" && Array.isArray(artifact.content)) {
    const rows = artifact.content
      .slice(0, 10)
      .map((row) => {
        const value = row as {
          item?: string;
          status?: string;
          evidence?: string;
          nextAction?: string;
        };
        return [
          `• *${value.item ?? "Checklist item"}* - ${value.status ?? "unknown"}`,
          `evidence: ${value.evidence ?? "none"}`,
          `next: ${value.nextAction ?? "none"}`
        ].join("\n");
      })
      .join("\n\n");
    return truncateForSlack(rows || "No Marketplace checklist rows were generated.");
  }

  if (artifact.type === "manifest_patch_plan" && Array.isArray(artifact.content)) {
    const rows = artifact.content
      .slice(0, 10)
      .map((row) => {
        const value = row as {
          path?: string;
          current?: unknown;
          suggested?: unknown;
          reason?: string;
        };
        return [
          `• *${value.path ?? "unknown path"}*`,
          `current: \`${formatInlineJson(value.current)}\``,
          `suggested: \`${formatInlineJson(value.suggested)}\``,
          `reason: ${value.reason ?? "none"}`
        ].join("\n");
      })
      .join("\n\n");
    return truncateForSlack(rows || "No manifest patch suggestions were generated.");
  }

  return truncateForSlack(`\`\`\`${JSON.stringify(artifact.content, null, 2)}\`\`\``);
}

function truncateForSlack(value: string): string {
  if (value.length <= 2800) return value;
  return `${value.slice(0, 2790)}...`;
}

function truncateInline(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatSimilarity(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "similarity unknown";
  return `${Math.round(value * 100)}% match`;
}

function formatInlineJson(value: unknown): string {
  if (value === undefined) return "undefined";
  const json = JSON.stringify(value);
  if (!json) return String(value);
  return json.length > 240 ? `${json.slice(0, 237)}...` : json;
}

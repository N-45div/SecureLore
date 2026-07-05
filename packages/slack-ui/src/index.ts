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
  artifactTypes: string[];
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
    .filter((finding) => finding.severity === "blocker" || finding.severity === "warn")
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
          text: `Artifacts: ${packet.inputSummary.artifactTypes.join(", ") || "none"}`
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
          .map((policy) => `• ${policy.title} (${policy.id})`)
          .join("\n")}`
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
      }
    ]
  });

  return blocks;
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

export function renderAppHome(reviews: ReviewHomeSummary[]): SlackBlock[] {
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
        text: "*Slack agent and MCP preflight reviews*"
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

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Recent reviews*"
    }
  });

  for (const review of reviews.slice(0, 10)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${review.grade.toUpperCase()}* - ${formatDate(review.createdAt)}`,
          `${review.blockerCount} blocker(s), ${review.warningCount} warning(s)`,
          `Artifacts: ${review.artifactTypes.join(", ") || "none"}`,
          `_${review.summary}_`
        ].join("\n")
      }
    });
  }

  return blocks;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace("T", " ");
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

  return truncateForSlack(`\`\`\`${JSON.stringify(artifact.content, null, 2)}\`\`\``);
}

function truncateForSlack(value: string): string {
  if (value.length <= 2800) return value;
  return `${value.slice(0, 2790)}...`;
}

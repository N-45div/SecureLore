import type { ReviewPacket, Severity } from "@securelore/review-core";

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
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

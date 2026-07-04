import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "@slack/bolt";
import { renderReviewPacket } from "@securelore/slack-ui";
import { runReviewFromForm } from "./input.js";
import { LocalStore } from "./storage/local-store.js";
import { ReviewStore } from "./storage/review-store.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../..");
const socketMode = process.env.SLACK_SOCKET_MODE !== "false";
const store = new ReviewStore({
  local: new LocalStore(join(repoRoot, ".data/slack")),
  databaseUrl: process.env.DATABASE_URL
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode
});

app.command("/securelore", async ({ command, ack, respond }) => {
  await ack();

  if (!command.text.trim().startsWith("review")) {
    await respond({
      response_type: "ephemeral",
      text: "Use `/securelore review` to open a preflight review form."
    });
    return;
  }

  await app.client.views.open({
    trigger_id: command.trigger_id,
    view: reviewModal()
  });
});

app.view("securelore_review_submit", async ({ ack, body, view, client }) => {
  const manifestJson =
    view.state.values.manifest_block?.manifest_json?.value ?? "";
  const mcpToolsJson = view.state.values.mcp_tools_block?.mcp_tools_json?.value ?? "";

  try {
    const packet = runReviewFromForm({ manifestJson, mcpToolsJson });
    await store.saveReview(packet, {
      slackTeamId: body.team?.id,
      slackUserId: body.user.id
    });
    await ack();
    await client.chat.postMessage({
      channel: body.user.id,
      text: packet.overallRisk.summary,
      blocks: renderReviewPacket(packet)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed.";
    await ack({
      response_action: "errors",
      errors: {
        manifest_block: message
      }
    });
  }
});

for (const actionId of [
  "feedback_good_fix",
  "feedback_bad_fix",
  "feedback_missed_issue",
  "feedback_false_alarm"
]) {
  app.action(actionId, async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const action = body.actions[0];
    const reviewId =
      action && "value" in action && typeof action.value === "string"
        ? action.value
        : "unknown";
    await store.appendFeedback({
      reviewId,
      actionId,
      userId: body.user.id,
      channelId: body.channel?.id,
      createdAt: new Date().toISOString()
    });
    await client.chat.postEphemeral({
      channel: body.channel?.id ?? "",
      user: body.user.id,
      text: "Feedback captured for the SecureLore learning queue."
    });
  });
}

app.event("app_mention", async ({ event, say }) => {
  if (!("text" in event) || !event.text?.toLowerCase().includes("review")) {
    await say("Mention me with `review` or run `/securelore review`.");
    return;
  }

  await say("Run `/securelore review` to paste a real Slack manifest or MCP tools/list response.");
});

function reviewModal() {
  return {
    type: "modal" as const,
    callback_id: "securelore_review_submit",
    title: {
      type: "plain_text" as const,
      text: "SecureLore Review"
    },
    submit: {
      type: "plain_text" as const,
      text: "Run review"
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel"
    },
    blocks: [
      {
        type: "input" as const,
        block_id: "manifest_block",
        optional: true,
        label: {
          type: "plain_text" as const,
          text: "Slack app manifest JSON"
        },
        element: {
          type: "plain_text_input" as const,
          action_id: "manifest_json",
          multiline: true,
          placeholder: {
            type: "plain_text" as const,
            text: "{ \"display_information\": ... }"
          }
        }
      },
      {
        type: "input" as const,
        block_id: "mcp_tools_block",
        optional: true,
        label: {
          type: "plain_text" as const,
          text: "MCP tools/list JSON"
        },
        element: {
          type: "plain_text_input" as const,
          action_id: "mcp_tools_json",
          multiline: true,
          placeholder: {
            type: "plain_text" as const,
            text: "{ \"tools\": [...] }"
          }
        }
      }
    ]
  };
}

await app.start(Number(process.env.PORT ?? 3000));
console.log("SecureLore Slack app is running.");

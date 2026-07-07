import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, type Receiver } from "@slack/bolt";
import { enrichReviewPacket } from "@securelore/agent-core";
import {
  renderAppHome,
  renderGeneratedArtifact,
  renderReviewPacket
} from "@securelore/slack-ui";
import type { GeneratedArtifact } from "@securelore/review-core";
import {
  classifySlackFileJson,
  downloadSlackFileJson,
  type SlackFileInfo
} from "./file-ingestion.js";
import { buildPolicyQueryFromForm, runReviewFromForm } from "./input.js";
import { createPolicyContextProvider } from "./policy-context.js";
import { LocalStore } from "./storage/local-store.js";
import { ReviewStore } from "./storage/review-store.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../..");

export function createSecureLoreApp(options: { receiver?: Receiver } = {}) {
  const socketMode = !options.receiver && process.env.SLACK_SOCKET_MODE !== "false";
  const store = new ReviewStore({
    local: new LocalStore(join(repoRoot, ".data/slack")),
    databaseUrl: process.env.DATABASE_URL
  });
  const policyContextProvider = createPolicyContextProvider(process.env);

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: socketMode ? process.env.SLACK_APP_TOKEN : undefined,
    socketMode,
    receiver: options.receiver
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

  app.event("app_home_opened", async ({ event, client, context }) => {
    const reviews = await store.listRecentReviews({
      slackTeamId: context.teamId,
      slackUserId: event.user,
      limit: 10
    });
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        blocks: renderAppHome(reviews)
      }
    });
  });

  app.event("file_shared", async ({ event, client, context }) => {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) return;

    try {
      const fileResponse = await client.files.info({
        file: event.file_id
      });
      const file = fileResponse.file as SlackFileInfo | undefined;
      if (!file) {
        throw new Error("Slack file metadata was not returned.");
      }

      const rawJson = await downloadSlackFileJson(file, botToken);
      const classified = classifySlackFileJson(rawJson);
      const policyContext = await policyContextProvider.retrieve(
        buildPolicyQueryFromForm(classified)
      );
      const deterministicPacket = runReviewFromForm({ ...classified, policyContext });
      const packet = await enrichReviewPacket(deterministicPacket, {
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL
      });

      await store.saveReview(packet, {
        slackTeamId: context.teamId,
        slackChannelId: event.channel_id,
        slackUserId: event.user_id
      });

      await client.chat.postMessage({
        channel: event.channel_id,
        text: packet.overallRisk.summary,
        blocks: renderReviewPacket(packet)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "File review failed.";
      await client.chat.postEphemeral({
        channel: event.channel_id,
        user: event.user_id,
        text: `SecureLore could not review that file: ${message}`
      });
    }
  });

  app.view("securelore_review_submit", async ({ ack, body, view, client }) => {
    const manifestJson =
      view.state.values.manifest_block?.manifest_json?.value ?? "";
    const mcpToolsJson =
      view.state.values.mcp_tools_block?.mcp_tools_json?.value ?? "";

    try {
      const policyContext = await policyContextProvider.retrieve(
        buildPolicyQueryFromForm({ manifestJson, mcpToolsJson })
      );
      const deterministicPacket = runReviewFromForm({
        manifestJson,
        mcpToolsJson,
        policyContext
      });
      const packet = await enrichReviewPacket(deterministicPacket, {
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL
      });
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

  for (const action of [
    { id: "artifact_admin_brief", type: "admin_approval_brief" },
    { id: "artifact_scope_table", type: "scope_justification_table" },
    { id: "artifact_mcp_metadata", type: "mcp_tool_metadata" }
  ] as const) {
    app.action(action.id, async ({ ack, body, client }) => {
      await ack();
      if (body.type !== "block_actions") return;
      const reviewId = getActionValue(body.actions[0]);
      const packet = await store.getReview(reviewId);

      if (!packet) {
        await client.chat.postEphemeral({
          channel: body.channel?.id ?? "",
          user: body.user.id,
          text: "Review packet was not found. Run the review again."
        });
        return;
      }

      const artifact = packet.generatedArtifacts?.find(
        (candidate) => candidate.type === action.type
      );

      if (!artifact) {
        await client.chat.postEphemeral({
          channel: body.channel?.id ?? "",
          user: body.user.id,
          text: "That artifact was not generated for this review."
        });
        return;
      }

      await client.chat.postEphemeral({
        channel: body.channel?.id ?? "",
        user: body.user.id,
        text: artifact.title,
        blocks: renderGeneratedArtifact(packet, artifact as GeneratedArtifact)
      });
    });
  }

  app.action("home_refresh", async ({ ack, body, client, context }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const reviews = await store.listRecentReviews({
      slackTeamId: context.teamId,
      slackUserId: body.user.id,
      limit: 10
    });
    await client.views.publish({
      user_id: body.user.id,
      view: {
        type: "home",
        blocks: renderAppHome(reviews)
      }
    });
  });

  app.action("home_new_review", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: reviewModal()
    });
  });

  app.event("app_mention", async ({ event, say }) => {
    if (!("text" in event) || !event.text?.toLowerCase().includes("review")) {
      await say("Mention me with `review` or run `/securelore review`.");
      return;
    }

    await say(
      "Run `/securelore review` to paste a real Slack manifest or MCP tools/list response."
    );
  });

  return app;
}

function getActionValue(action: unknown): string {
  if (
    action &&
    typeof action === "object" &&
    "value" in action &&
    typeof action.value === "string"
  ) {
    return action.value;
  }

  return "unknown";
}

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

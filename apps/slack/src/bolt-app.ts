import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, type Receiver } from "@slack/bolt";
import { waitUntil } from "@vercel/functions";
import { enrichReviewPacket } from "@securelore/agent-core";
import {
  renderAppHome,
  renderGeneratedArtifact,
  renderReviewPacket,
  renderReviewRoom
} from "@securelore/slack-ui";
import type { GeneratedArtifact, ReviewPacket } from "@securelore/review-core";
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
const isVercel = process.env.VERCEL === "1";

export function createSecureLoreApp(options: { receiver?: Receiver } = {}) {
  const socketMode = !options.receiver && process.env.SLACK_SOCKET_MODE !== "false";
  const store = new ReviewStore({
    local: isVercel ? undefined : new LocalStore(join(repoRoot, ".data/slack")),
    databaseUrl: process.env.DATABASE_URL
  });
  const policyContextProvider = createPolicyContextProvider(process.env);
  const logger = createRuntimeLogger();

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
      await postReviewRoom({
        client,
        channel: event.channel_id,
        packet,
        store,
        logger
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
      runReviewFromForm({ manifestJson, mcpToolsJson });
      await ack();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review failed.";
      await ack({
        response_action: "errors",
        errors: {
          manifest_block: message
        }
      });
      return;
    }

    const reviewWork = (async () => {
      try {
        logger("modal_review_started", {
          teamId: body.team?.id,
          userId: body.user.id,
          manifestBytes: manifestJson.length,
          mcpToolsBytes: mcpToolsJson.length
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: "SecureLore review started. I will post the policy-grounded packet here when it is ready."
        });
        logger("modal_review_start_notice_posted", {
          userId: body.user.id
        });
        const policyContext = await policyContextProvider.retrieve(
          buildPolicyQueryFromForm({ manifestJson, mcpToolsJson })
        );
        logger("modal_policy_context_retrieved", {
          count: policyContext.length
        });
        const deterministicPacket = runReviewFromForm({
          manifestJson,
          mcpToolsJson,
          policyContext
        });
        const packet = await enrichReviewPacket(deterministicPacket, {
          openRouterApiKey: process.env.OPENROUTER_API_KEY,
          model: process.env.OPENROUTER_MODEL
        });
        logger("modal_review_enriched", {
          reviewId: packet.reviewId,
          grade: packet.overallRisk.grade,
          findings: packet.findings.length
        });
        await store.saveReview(packet, {
          slackTeamId: body.team?.id,
          slackUserId: body.user.id
        });
        logger("modal_review_saved", {
          reviewId: packet.reviewId
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: packet.overallRisk.summary,
          blocks: renderReviewPacket(packet)
        });
        logger("modal_review_posted", {
          reviewId: packet.reviewId,
          userId: body.user.id
        });
        await postReviewRoom({
          client,
          channel: body.user.id,
          packet,
          store,
          logger
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Review failed.";
        logger("modal_review_failed", {
          message
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: `SecureLore review failed: ${message}`
        });
      }
    })();

    if (isVercel) {
      waitUntil(reviewWork);
    } else {
      void reviewWork;
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
      const responseChannel = getResponseChannel(body);
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
      logger("feedback_recorded", {
        actionId,
        reviewId,
        userId: body.user.id
      });
      await client.chat.postMessage({
        channel: responseChannel,
        text: "Feedback captured for the SecureLore learning queue."
      });
    });
  }

  for (const action of [
    { id: "artifact_admin_brief", type: "admin_approval_brief" },
    { id: "artifact_scope_table", type: "scope_justification_table" },
    { id: "artifact_mcp_metadata", type: "mcp_tool_metadata" },
    { id: "artifact_marketplace_checklist", type: "marketplace_checklist" },
    { id: "artifact_manifest_patch_plan", type: "manifest_patch_plan" }
  ] as const) {
    app.action(action.id, async ({ ack, body, client }) => {
      await ack();
      if (body.type !== "block_actions") return;
      const reviewId = getActionValue(body.actions[0]);
      const responseChannel = getResponseChannel(body);
      logger("artifact_requested", {
        artifactType: action.type,
        reviewId,
        userId: body.user.id
      });
      const packet = await store.getReview(reviewId);

      if (!packet) {
        logger("artifact_missing_review", {
          artifactType: action.type,
          reviewId
        });
        await client.chat.postMessage({
          channel: responseChannel,
          text: "Review packet was not found. Run the review again."
        });
        return;
      }

      const artifact = packet.generatedArtifacts?.find(
        (candidate) => candidate.type === action.type
      );

      if (!artifact) {
        logger("artifact_missing", {
          artifactType: action.type,
          reviewId
        });
        await client.chat.postMessage({
          channel: responseChannel,
          text: "That artifact was not generated for this review."
        });
        return;
      }

      await client.chat.postMessage({
        channel: responseChannel,
        text: artifact.title,
        blocks: renderGeneratedArtifact(packet, artifact as GeneratedArtifact)
      });
      logger("artifact_posted", {
        artifactType: action.type,
        reviewId,
        userId: body.user.id
      });
    });
  }

  app.action("room_add_evidence", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    const reviewId = getActionValue(body.actions[0]);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: evidenceModal(reviewId)
    });
  });

  app.view("securelore_evidence_submit", async ({ ack, body, view, client }) => {
    const reviewId = view.private_metadata;
    const evidence =
      view.state.values.evidence_block?.evidence_text?.value?.trim() ?? "";

    if (!reviewId || reviewId === "unknown") {
      await ack({
        response_action: "errors",
        errors: {
          evidence_block: "Review ID was missing. Run a new SecureLore review."
        }
      });
      return;
    }

    if (!evidence) {
      await ack({
        response_action: "errors",
        errors: {
          evidence_block: "Add the evidence, justification, or follow-up answer to save."
        }
      });
      return;
    }

    await ack();

    const evidenceWork = (async () => {
      try {
        await store.appendReviewEvidence({
          reviewId,
          evidence,
          userId: body.user.id,
          createdAt: new Date().toISOString()
        });
        logger("review_evidence_saved", {
          reviewId,
          userId: body.user.id
        });

        const packet = await store.getReview(reviewId);
        if (!packet) {
          await client.chat.postMessage({
            channel: body.user.id,
            text: `Evidence captured for ${reviewId}, but the review packet was not found.`
          });
          return;
        }

        await client.chat.postMessage({
          channel: body.user.id,
          text: `Evidence captured for ${reviewId}.`
        });
        await postReviewRoom({
          client,
          channel: body.user.id,
          packet,
          store,
          logger
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Evidence save failed.";
        logger("review_evidence_failed", {
          reviewId,
          message
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: `SecureLore could not save that evidence: ${message}`
        });
      }
    })();

    if (isVercel) {
      waitUntil(evidenceWork);
    } else {
      void evidenceWork;
    }
  });

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

function createRuntimeLogger() {
  return (event: string, fields: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({
      service: "securelore",
      event,
      ...fields
    }));
  };
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

function getResponseChannel(body: { channel?: { id?: string }; user: { id: string } }): string {
  return body.channel?.id || body.user.id;
}

async function postReviewRoom(options: {
  client: App["client"];
  channel: string;
  packet: ReviewPacket;
  store: ReviewStore;
  logger: ReturnType<typeof createRuntimeLogger>;
}): Promise<void> {
  const evidenceCount = await options.store.countReviewEvidence(options.packet.reviewId);
  await options.client.chat.postMessage({
    channel: options.channel,
    text: `SecureLore review room for ${options.packet.reviewId}`,
    blocks: renderReviewRoom(options.packet, evidenceCount)
  });
  options.logger("review_room_posted", {
    reviewId: options.packet.reviewId,
    channel: options.channel,
    evidenceCount
  });
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

function evidenceModal(reviewId: string) {
  return {
    type: "modal" as const,
    callback_id: "securelore_evidence_submit",
    private_metadata: reviewId,
    title: {
      type: "plain_text" as const,
      text: "Add Evidence"
    },
    submit: {
      type: "plain_text" as const,
      text: "Save"
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel"
    },
    blocks: [
      {
        type: "input" as const,
        block_id: "evidence_block",
        label: {
          type: "plain_text" as const,
          text: "Evidence or admin answer"
        },
        element: {
          type: "plain_text_input" as const,
          action_id: "evidence_text",
          multiline: true,
          placeholder: {
            type: "plain_text" as const,
            text: "Example: files:read is only used when a builder uploads review JSON. No Slack file content is retained."
          }
        }
      }
    ]
  };
}

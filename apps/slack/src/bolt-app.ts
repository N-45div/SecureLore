import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, Assistant, type Receiver } from "@slack/bolt";
import { waitUntil } from "@vercel/functions";
import { enrichReviewPacket, evaluateFindingEvidence } from "@securelore/agent-core";
import {
  renderAppHome,
  renderAdminBriefWithEvidence,
  renderGeneratedArtifact,
  renderLearningTrace,
  renderReviewPacket,
  renderReviewRoom
} from "@securelore/slack-ui";
import {
  applyEvidenceAssessment,
  type EvidenceAssessment,
  type GeneratedArtifact,
  type ReviewPacket
} from "@securelore/review-core";
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

  const assistant = new Assistant({
    threadStarted: async ({ setSuggestedPrompts, say }) => {
      await setSuggestedPrompts({
        title: "Review an agent before admin approval",
        prompts: [
          {
            title: "Start a preflight review",
            message: "Review a Slack agent"
          },
          {
            title: "How SecureLore works",
            message: "Help"
          }
        ]
      });
      await say(
        "SecureLore reviews real Slack manifests and MCP tools, gathers finding-specific evidence, and creates an admin-ready packet."
      );
    },
    threadContextChanged: async ({ saveThreadContext }) => {
      await saveThreadContext();
    },
    userMessage: async ({ event, say, setStatus, setTitle }) => {
      const text = "text" in event && typeof event.text === "string"
        ? event.text.trim().toLowerCase()
        : "";
      await setStatus("Preparing SecureLore");

      if (text === "help" || text.includes("how securelore works")) {
        await setTitle("SecureLore help");
        await say(
          "Start a review here, submit a Slack manifest or MCP tools/list response, then use the Review Room to add evidence and generate an admin brief."
        );
        return;
      }

      await setTitle("Slack agent preflight review");
      await say({
        text: "Start a policy-grounded review with real Slack and MCP artifacts.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Ready to review an agent?*\nSecureLore will check scopes, endpoints, disclosures, MCP metadata, and required evidence."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Start review"
                },
                style: "primary",
                action_id: "assistant_start_review"
              }
            ]
          }
        ]
      });
    }
  });

  app.use(assistant.getMiddleware());

  app.action("assistant_start_review", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: reviewModal()
    });
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

      if (action.type === "admin_approval_brief") {
        const evidence = await store.listReviewEvidence(reviewId, 5);
        await client.chat.postMessage({
          channel: responseChannel,
          text: artifact.title,
          blocks: renderAdminBriefWithEvidence(packet, artifact as GeneratedArtifact, evidence)
        });
        logger("artifact_posted", {
          artifactType: action.type,
          reviewId,
          userId: body.user.id,
          evidenceCount: evidence.length
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

  app.action("artifact_learning_trace", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const reviewId = getActionValue(body.actions[0]);
    const responseChannel = getResponseChannel(body);
    const packet = await store.getReview(reviewId);

    if (!packet) {
      await client.chat.postMessage({
        channel: responseChannel,
        text: "Review packet was not found. Run the review again."
      });
      return;
    }

    await client.chat.postMessage({
      channel: responseChannel,
      text: `Learning trace for ${reviewId}`,
      blocks: renderLearningTrace(packet)
    });
    logger("learning_trace_posted", {
      reviewId,
      userId: body.user.id
    });
  });

  app.action("room_add_evidence", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    const reviewId = getActionValue(body.actions[0]);
    const packet = await store.getReview(reviewId);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: evidenceModal(reviewId, packet ?? undefined)
    });
  });

  app.view("securelore_evidence_submit", async ({ ack, body, view, client }) => {
    const reviewId = view.private_metadata;
    const evidence =
      view.state.values.evidence_block?.evidence_text?.value?.trim() ?? "";
    const questionId =
      view.state.values.evidence_question_block?.evidence_question?.selected_option?.value;

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
          questionId,
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

        const finding = questionId
          ? packet.findings.find((candidate) => candidate.id === questionId)
          : undefined;
        let updatedPacket = packet;
        let assessment: EvidenceAssessment = {
          decision: "not_evaluated",
          rationale: questionId
            ? "The related finding was not available for evaluation."
            : "General evidence was stored without resolving a specific finding.",
          evaluatedBy: "securelore-agent",
          evaluatedAt: new Date().toISOString()
        };

        if (finding) {
          try {
            assessment = await evaluateFindingEvidence(
              finding,
              evidence,
              packet.policyContext,
              {
                openRouterApiKey: process.env.OPENROUTER_API_KEY,
                model: process.env.OPENROUTER_MODEL
              }
            );
          } catch (error) {
            assessment = {
              decision: "not_evaluated",
              rationale: `Evidence was saved, but evaluation failed: ${error instanceof Error ? error.message : "unknown error"}`,
              evaluatedBy: "securelore-agent",
              evaluatedAt: new Date().toISOString()
            };
          }
          updatedPacket = applyEvidenceAssessment(packet, finding.id, assessment);
          await store.saveReview(updatedPacket, {
            slackTeamId: body.team?.id,
            slackUserId: body.user.id
          });
        }

        await client.chat.postMessage({
          channel: body.user.id,
          text: [
            `Evidence captured for ${reviewId}.`,
            assessment.decision === "sufficient"
              ? "The related finding was resolved and the risk grade was recalculated."
              : assessment.rationale
          ].join(" ")
        });
        await postReviewRoom({
          client,
          channel: body.user.id,
          packet: updatedPacket,
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

  app.action("room_promote_lesson", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    const reviewId = getActionValue(body.actions[0]);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: lessonModal(reviewId)
    });
  });

  app.view("securelore_lesson_submit", async ({ ack, body, view, client }) => {
    const reviewId = view.private_metadata;
    const lesson =
      view.state.values.lesson_block?.lesson_text?.value?.trim() ?? "";
    const kind =
      view.state.values.lesson_kind_block?.lesson_kind?.selected_option?.value ??
      "admin_evidence";

    if (!reviewId || reviewId === "unknown") {
      await ack({
        response_action: "errors",
        errors: {
          lesson_block: "Review ID was missing. Run a new SecureLore review."
        }
      });
      return;
    }

    if (lesson.length < 24) {
      await ack({
        response_action: "errors",
        errors: {
          lesson_block: "Write a sanitized lesson with enough detail to help future reviews."
        }
      });
      return;
    }

    await ack();

    const lessonWork = (async () => {
      try {
        if (!policyContextProvider.promoteLearningExample) {
          await client.chat.postMessage({
            channel: body.user.id,
            text: "Learning memory is not configured. Set DATABASE_URL and COHERE_API_KEY to promote lessons."
          });
          return;
        }

        await policyContextProvider.promoteLearningExample({
          sourceReviewId: reviewId,
          kind,
          content: sanitizeLearningLesson(lesson)
        });
        logger("learning_lesson_promoted", {
          reviewId,
          kind,
          userId: body.user.id
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: [
            `Learning lesson promoted for ${reviewId}.`,
            "SecureLore will retrieve it as product memory in future reviews.",
            "This does not train an LLM or send Slack data for model training."
          ].join(" ")
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lesson promotion failed.";
        logger("learning_lesson_failed", {
          reviewId,
          message
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: `SecureLore could not promote that lesson: ${message}`
        });
      }
    })();

    if (isVercel) {
      waitUntil(lessonWork);
    } else {
      void lessonWork;
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

  app.action("home_open_room", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const reviewId = getActionValue(body.actions[0]);
    const packet = await store.getReview(reviewId);
    if (!packet) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: "Review packet was not found. Run the review again."
      });
      return;
    }

    await postReviewRoom({
      client,
      channel: body.user.id,
      packet,
      store,
      logger
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

function sanitizeLearningLesson(value: string): string {
  return value
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "[redacted-slack-token]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted-api-key]")
    .replace(/postgresql:\/\/\S+/g, "[redacted-database-url]")
    .slice(0, 1600);
}

async function postReviewRoom(options: {
  client: App["client"];
  channel: string;
  packet: ReviewPacket;
  store: ReviewStore;
  logger: ReturnType<typeof createRuntimeLogger>;
}): Promise<void> {
  const evidence = await options.store.listReviewEvidence(options.packet.reviewId, 5);
  await options.client.chat.postMessage({
    channel: options.channel,
    text: `SecureLore review room for ${options.packet.reviewId}`,
    blocks: renderReviewRoom(options.packet, evidence.length, evidence)
  });
  options.logger("review_room_posted", {
    reviewId: options.packet.reviewId,
    channel: options.channel,
    evidenceCount: evidence.length
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

function evidenceModal(reviewId: string, packet?: ReviewPacket) {
  const findingOptions = (packet?.findings ?? [])
    .filter((finding) =>
      (finding.severity === "blocker" || finding.severity === "warn") &&
      finding.resolution?.status !== "resolved"
    )
    .slice(0, 10)
    .map((finding) => ({
      text: {
        type: "plain_text" as const,
        text: finding.title.slice(0, 75)
      },
      value: finding.id
    }));
  const blocks: Array<{
    type: "input";
    block_id: string;
    optional?: boolean;
    label: { type: "plain_text"; text: string };
    hint?: { type: "plain_text"; text: string };
    element: Record<string, unknown>;
  }> = [];

  if (findingOptions.length > 0) {
    blocks.push({
      type: "input" as const,
      block_id: "evidence_question_block",
      optional: true,
      label: {
        type: "plain_text" as const,
        text: "Related finding"
      },
      element: {
        type: "static_select" as const,
        action_id: "evidence_question",
        placeholder: {
          type: "plain_text" as const,
          text: "Choose the finding this evidence answers"
        },
        options: findingOptions
      }
    });
  }

  blocks.push({
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
  });

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
    blocks
  };
}

function lessonModal(reviewId: string) {
  return {
    type: "modal" as const,
    callback_id: "securelore_lesson_submit",
    private_metadata: reviewId,
    title: {
      type: "plain_text" as const,
      text: "Promote Lesson"
    },
    submit: {
      type: "plain_text" as const,
      text: "Promote"
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel"
    },
    blocks: [
      {
        type: "input" as const,
        block_id: "lesson_kind_block",
        label: {
          type: "plain_text" as const,
          text: "Lesson type"
        },
        element: {
          type: "static_select" as const,
          action_id: "lesson_kind",
          initial_option: {
            text: {
              type: "plain_text" as const,
              text: "Admin evidence"
            },
            value: "admin_evidence"
          },
          options: [
            {
              text: {
                type: "plain_text" as const,
                text: "Admin evidence"
              },
              value: "admin_evidence"
            },
            {
              text: {
                type: "plain_text" as const,
                text: "False alarm"
              },
              value: "false_alarm"
            },
            {
              text: {
                type: "plain_text" as const,
                text: "Accepted fix"
              },
              value: "accepted_fix"
            },
            {
              text: {
                type: "plain_text" as const,
                text: "Scope justification"
              },
              value: "scope_justification"
            }
          ]
        }
      },
      {
        type: "input" as const,
        block_id: "lesson_block",
        label: {
          type: "plain_text" as const,
          text: "Sanitized lesson"
        },
        hint: {
          type: "plain_text" as const,
          text: "Do not include tokens, secrets, private customer data, or raw Slack messages."
        },
        element: {
          type: "plain_text_input" as const,
          action_id: "lesson_text",
          multiline: true,
          placeholder: {
            type: "plain_text" as const,
            text: "Example: files:read is acceptable only when the app has a visible user-triggered file review workflow, documents retention, and avoids storing file content."
          }
        }
      }
    ]
  };
}

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, type Receiver } from "@slack/bolt";
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
  compareReviewPackets,
  recordReviewDecision,
  type EvidenceAssessment,
  type GeneratedArtifact,
  type ReviewPacket
} from "@securelore/review-core";
import {
  classifySlackFileJson,
  downloadSlackFileJson,
  type SlackFileInfo
} from "./file-ingestion.js";
import { buildPolicyQueryFromForm, runReviewFromForm, type SlackReviewFormInput } from "./input.js";
import { createPolicyContextProvider } from "./policy-context.js";
import { isAuthorizedReviewer, parseReviewerIds } from "./governance.js";
import {
  buildWorkspaceEvidenceQuery,
  describeRtsError,
  isWorkspaceEvidenceRequest,
  missingRtsActionTokenMessage,
  renderWorkspaceEvidenceBlocks,
  searchWorkspaceEvidence
} from "./rts-search.js";
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
  const logger = createRuntimeLogger();
  const policyContextProvider = createPolicyContextProvider(process.env, { logger });
  const reviewerIds = parseReviewerIds(process.env.SLACK_REVIEWER_IDS);
  const isReviewer = (userId: string) => isAuthorizedReviewer(reviewerIds, userId);

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    botId: process.env.SLACK_BOT_ID,
    botUserId: process.env.SLACK_BOT_USER_ID,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: socketMode ? process.env.SLACK_APP_TOKEN : undefined,
    socketMode,
    receiver: options.receiver,
    tokenVerificationEnabled: false,
    clientOptions: {
      timeout: 12_000,
      retryConfig: { retries: 0 }
    }
  });

  app.error(async (error) => {
    logger("bolt_request_failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "unknown",
      message: error instanceof Error ? error.message : "unknown"
    });
  });

  app.message(async (args) => {
    const messageWork = (async () => {
      const { message, client, context, setStatus } = args;
      if (("subtype" in message && message.subtype !== undefined) || "bot_id" in message) return;
      if (!("channel_type" in message) || message.channel_type !== "im") return;
      if (!("user" in message) || typeof message.user !== "string") return;
      if (!("text" in message) || typeof message.text !== "string") return;

    const rawText = message.text.trim();
    const text = rawText.toLowerCase();
    const threadTs = "thread_ts" in message && typeof message.thread_ts === "string"
      ? message.thread_ts
      : message.ts;
    const replyText = (responseText: string) => client.chat.postMessage({
      channel: message.channel,
      thread_ts: threadTs,
      text: responseText
    });
    const setTitle = (title: string) => client.assistant.threads.setTitle({
      channel_id: message.channel,
      thread_ts: threadTs,
      title
    });

    if (text === "help" || text.includes("how securelore works")) {
      await runBestEffort("agent_title_update", () => setTitle("SecureLore help"), logger);
      await replyText(
        "Start a review here, submit a Slack manifest or MCP tools/list response, then use the Review Room to add evidence and generate an admin brief."
      );
      return;
    }

    if (isWorkspaceEvidenceRequest(rawText)) {
      await Promise.all([
        runBestEffort("agent_title_update", () => setTitle("Workspace evidence scout"), logger),
        runBestEffort("agent_status_update", () => setStatus("Searching live workspace precedent"), logger)
      ]);
      const actionToken = (message as typeof message & { action_token?: string }).action_token;
      logger("agent_workspace_evidence_requested", {
        teamId: context.teamId,
        userId: message.user,
        hasActionToken: Boolean(actionToken),
        isThreadReply: "thread_ts" in message && typeof message.thread_ts === "string"
      });
      if (!actionToken) {
        await replyText(missingRtsActionTokenMessage);
        return;
      }

      try {
        let packet: ReviewPacket | null = null;
        try {
          packet = await withTimeout((async () => {
            const latest = await store.listRecentReviews({
              slackTeamId: context.teamId,
              slackUserId: message.user,
              limit: 1
            });
            return latest[0]
              ? store.getReview(latest[0].id, context.teamId)
              : null;
          })(), 1_500, "Review context lookup timed out");
        } catch (error) {
          logger("rts_review_context_unavailable", {
            teamId: context.teamId,
            userId: message.user,
            error: error instanceof Error ? error.message : "unknown"
          });
        }

        const search = await searchWorkspaceEvidence(client, {
          query: buildWorkspaceEvidenceQuery(rawText, packet ?? undefined),
          actionToken
        });
        await client.chat.postMessage({
          channel: message.channel,
          thread_ts: threadTs,
          text: `SecureLore found ${search.results.length} live workspace precedent result(s).`,
          blocks: renderWorkspaceEvidenceBlocks(search),
          unfurl_links: false,
          unfurl_media: false
        });
        logger("rts_workspace_evidence_completed", {
          teamId: context.teamId,
          userId: message.user,
          resultCount: search.results.length
        });
      } catch (error) {
        logger("rts_workspace_evidence_failed", {
          teamId: context.teamId,
          userId: message.user,
          errorCode: error && typeof error === "object" && "code" in error ? error.code : "unknown"
        });
        await replyText(describeRtsError(error));
      }
      return;
    }

    await runBestEffort(
      "agent_title_update",
      () => setTitle("Slack agent preflight review"),
      logger
    );
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: threadTs,
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
    })();

    if (isVercel) {
      waitUntil(messageWork);
    } else {
      await messageWork;
    }
  });

  app.action("assistant_start_review", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await runAcknowledgedWork(
      "assistant_review_modal",
      () => client.views.open({ trigger_id: body.trigger_id, view: reviewModal() }),
      logger
    );
  });

  app.command("/securelore", async ({ command, ack, respond, client }) => {
    await ack();

    if (!command.text.trim().startsWith("review")) {
      await runAcknowledgedWork(
        "slash_usage_response",
        () => respond({
          response_type: "ephemeral",
          text: "Use `/securelore review` to open a preflight review form."
        }),
        logger
      );
      return;
    }

    logger("slash_review_requested", {
      teamId: command.team_id,
      userId: command.user_id,
      channelId: command.channel_id
    });
    await runAcknowledgedWork(
      "slash_review_modal",
      () => client.views.open({ trigger_id: command.trigger_id, view: reviewModal() }),
      logger,
      () => respond({
        response_type: "ephemeral",
        text: "SecureLore could not open the review form. Run `/securelore review` again."
      })
    );
  });

  app.event("app_home_opened", async ({ event, client, context }) => {
    if (event.tab === "messages") {
      logger("agent_messages_opened", {
        teamId: context.teamId,
        userId: event.user
      });
      return;
    }

    const homeWork = (async () => {
      const reviewerMode = isReviewer(event.user);
      const reviews = await store.listRecentReviews({
        slackTeamId: context.teamId,
        slackUserId: reviewerMode ? undefined : event.user,
        limit: 10
      }).catch((error) => {
        logger("app_home_reviews_unavailable", {
          teamId: context.teamId,
          userId: event.user,
          error: error instanceof Error ? error.message : "unknown"
        });
        return [];
      });
      await client.views.publish({
        user_id: event.user,
        view: {
          type: "home",
          blocks: renderAppHome(reviews, { reviewerMode })
        }
      });
      logger("app_home_published", {
        teamId: context.teamId,
        userId: event.user,
        reviewCount: reviews.length
      });
    })().catch((error) => {
      logger("app_home_publish_failed", {
        teamId: context.teamId,
        userId: event.user,
        message: error instanceof Error ? error.message : "unknown"
      });
    });
    await retainSlackWork(homeWork);
  });

  // Agent View supplies the active Slack context on later message.im events.
  // Keep this signal observable without persisting message or channel content.
  app.event("app_context_changed", async ({ event }) => {
    logger("agent_context_changed", {
      entityCount: event.context?.entities?.length ?? 0
    });
  });

  app.event("file_shared", async ({ event, client, context }) => {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) return;

    const fileWork = (async () => {
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
          buildPolicyQueryFromForm(classified),
          context.teamId
        );
        const deterministicPacket = runReviewFromForm({
          ...classified,
          policyContext,
          workspacePolicyJson: process.env.SECURELORE_WORKSPACE_POLICY_JSON
        });
        const packet = await enrichReviewPacketBestEffort(
          deterministicPacket,
          logger,
          "file_review"
        );

        await withTimeout(
          store.saveReview(packet, {
            slackTeamId: context.teamId,
            slackChannelId: event.channel_id,
            slackUserId: event.user_id
          }),
          8_000,
          "Review persistence exceeded 8000ms"
        );

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
        logger("file_review_failed", { message, fileId: event.file_id });
        try {
          await client.chat.postEphemeral({
            channel: event.channel_id,
            user: event.user_id,
            text: `SecureLore could not review that file: ${message}`
          });
        } catch (notificationError) {
          logger("file_review_notification_failed", {
            message: notificationError instanceof Error ? notificationError.message : "unknown"
          });
        }
      }
    })();
    await retainSlackWork(fileWork);
  });

  app.view("securelore_review_submit", async ({ ack, body, view, client }) => {
    const formInput: SlackReviewFormInput = {
      manifestJson: view.state.values.manifest_block?.manifest_json?.value ?? "",
      mcpToolsJson: view.state.values.mcp_tools_block?.mcp_tools_json?.value ?? "",
      declaredFeaturesText: view.state.values.declared_features_block?.declared_features?.value ?? "",
      publicPagesText: view.state.values.public_pages_block?.public_pages?.value ?? "",
      aiModel: view.state.values.ai_model_block?.ai_model?.value ?? "",
      aiRetention: view.state.values.ai_retention_block?.ai_retention?.value ?? "",
      aiTrainingUse: view.state.values.ai_training_block?.ai_training?.selected_option?.value ?? "",
      scopeJustificationsText: view.state.values.scope_justifications_block?.scope_justifications?.value ?? "",
      consequentialActionsText: view.state.values.consequential_actions_block?.consequential_actions?.value ?? "",
      humanReviewControls: view.state.values.human_review_controls_block?.human_review_controls?.value ?? "",
      runtimeEvidenceText: view.state.values.runtime_evidence_block?.runtime_evidence?.value ?? "",
      workspacePolicyJson: process.env.SECURELORE_WORKSPACE_POLICY_JSON
    };
    const manifestJson = formInput.manifestJson ?? "";
    const mcpToolsJson = formInput.mcpToolsJson ?? "";

    try {
      runReviewFromForm(formInput);
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
          buildPolicyQueryFromForm(formInput),
          body.team?.id
        );
        logger("modal_policy_context_retrieved", {
          count: policyContext.length
        });
        const deterministicPacket = runReviewFromForm({
          ...formInput,
          policyContext
        });
        let packet = await enrichReviewPacketBestEffort(
          deterministicPacket,
          logger,
          "modal_review"
        );
        const parentReviewId = view.private_metadata || undefined;
        if (parentReviewId) {
          try {
            const parentPacket = await withTimeout(
              store.getReview(parentReviewId, body.team?.id),
              3_000,
              "Parent review lookup exceeded 3000ms"
            );
            if (parentPacket) packet = compareReviewPackets(parentPacket, packet);
          } catch (error) {
            logger("modal_review_comparison_skipped", {
              reviewId: parentReviewId,
              reason: error instanceof Error ? error.message : "lookup_failed"
            });
          }
        }
        logger("modal_review_enriched", {
          reviewId: packet.reviewId,
          grade: packet.overallRisk.grade,
          findings: packet.findings.length
        });
        await withTimeout(
          store.saveReview(packet, {
            slackTeamId: body.team?.id,
            slackUserId: body.user.id
          }),
          8_000,
          "Review persistence exceeded 8000ms"
        );
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
      await runAcknowledgedWork(
        "feedback_capture",
        async () => {
          await store.appendFeedback({
            reviewId,
            actionId,
            userId: body.user.id,
            channelId: body.channel?.id,
            createdAt: new Date().toISOString()
          });
          let evalCreated = false;
          if (actionId === "feedback_missed_issue" || actionId === "feedback_false_alarm") {
            const packet = await store.getReview(reviewId, body.team?.id);
            if (packet) {
              evalCreated = await store.saveEvalCase({
                id: `eval-${randomUUID()}`,
                sourceReviewId: reviewId,
                task: actionId === "feedback_missed_issue"
                  ? "detect_missed_review_issue"
                  : "prevent_false_alarm",
                input: {
                  inputSummary: packet.inputSummary,
                  findings: packet.findings,
                  policyContextIds: packet.policyContext?.map((policy) => policy.id) ?? []
                },
                expected: {
                  feedback: actionId,
                  reviewRequired: true
                },
                status: "candidate"
              });
            }
          }
          logger("feedback_recorded", {
            actionId,
            reviewId,
            userId: body.user.id
          });
          await client.chat.postMessage({
            channel: responseChannel,
            text: evalCreated
              ? "Feedback captured and a candidate regression eval was created for review."
              : "Feedback captured for review analytics."
          });
        },
        logger
      );
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
      await runAcknowledgedWork("artifact_render", async () => {
        const packet = await store.getReview(reviewId, body.team?.id);

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
      }, logger);
    });
  }

  app.action("artifact_learning_trace", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const reviewId = getActionValue(body.actions[0]);
    const responseChannel = getResponseChannel(body);
    await runAcknowledgedWork("learning_trace", async () => {
      const packet = await store.getReview(reviewId, body.team?.id);
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
    }, logger);
  });

  app.action("room_add_evidence", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    const reviewId = getActionValue(body.actions[0]);
    await runAcknowledgedWork(
      "evidence_modal",
      async () => {
        const packet = await withTimeout(
          store.getReview(reviewId, body.team?.id),
          800,
          "Evidence context lookup timed out"
        ).catch((error) => {
          logger("evidence_modal_context_unavailable", {
            reviewId,
            message: error instanceof Error ? error.message : "unknown"
          });
          return null;
        });
        return client.views.open({
          trigger_id: body.trigger_id,
          view: evidenceModal(reviewId, packet ?? undefined)
        });
      },
      logger
    );
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

        const packet = await store.getReview(reviewId, body.team?.id);
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
    if (!isReviewer(body.user.id)) {
      await runAcknowledgedWork(
        "lesson_promotion_denied",
        () => client.chat.postMessage({
          channel: body.user.id,
          text: "Only a configured SecureLore reviewer can promote shared learning lessons. You can still add evidence to this review."
        }),
        logger
      );
      return;
    }
    const reviewId = getActionValue(body.actions[0]);

    await runAcknowledgedWork(
      "lesson_modal",
      () => client.views.open({ trigger_id: body.trigger_id, view: lessonModal(reviewId) }),
      logger
    );
  });

  app.action("room_submit_fix", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await runAcknowledgedWork(
      "fix_modal",
      () => client.views.open({
        trigger_id: body.trigger_id,
        view: reviewModal(getActionValue(body.actions[0]))
      }),
      logger
    );
  });

  app.action("room_record_decision", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await runAcknowledgedWork(
      "decision_modal",
      () => client.views.open({
        trigger_id: body.trigger_id,
        view: decisionModal(getActionValue(body.actions[0]))
      }),
      logger
    );
  });

  app.action("room_request_admin_review", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const reviewId = getActionValue(body.actions[0]);
    await runAcknowledgedWork("admin_review_request", async () => {
      const packet = await store.getReview(reviewId, body.team?.id);
      const approvalChannel = process.env.SLACK_APPROVAL_CHANNEL_ID;
      if (!packet) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: "Review packet was not found. Run the review again."
        });
        return;
      }
      if (!packet.artifactFingerprint) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: "This is a legacy review without an artifact fingerprint. Run a new review before requesting admin approval."
        });
        return;
      }
      if (!approvalChannel) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: "An admin review channel is not configured. Set `SLACK_APPROVAL_CHANNEL_ID` before requesting approval."
        });
        return;
      }

      await client.chat.postMessage({
        channel: approvalChannel,
        text: `<@${body.user.id}> requested admin review for ${reviewId}.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Admin review requested by <@${body.user.id}>*\nArtifact: \`${packet.artifactFingerprint}\``
            }
          },
          ...renderReviewPacket(packet)
        ]
      });
      await postReviewRoom({
        client,
        channel: approvalChannel,
        packet,
        store,
        logger
      });
      await client.chat.postMessage({
        channel: body.user.id,
        text: `Admin review requested in <#${approvalChannel}> for artifact ${packet.artifactFingerprint.slice(0, 20)}…`
      });
    }, logger);
  });

  app.view("securelore_decision_submit", async ({ ack, body, view, client }) => {
    const reviewId = view.private_metadata;
    const status = view.state.values.decision_status_block?.decision_status?.selected_option?.value;
    const rationale = view.state.values.decision_rationale_block?.decision_rationale?.value?.trim() ?? "";
    if (!isReviewer(body.user.id)) {
      await ack({
        response_action: "errors",
        errors: {
          decision_rationale_block: "Only a reviewer configured in SLACK_REVIEWER_IDS can record this decision."
        }
      });
      return;
    }
    if (!reviewId || !status || rationale.length < 12) {
      await ack({
        response_action: "errors",
        errors: {
          decision_rationale_block: "Add a concrete review rationale of at least 12 characters."
        }
      });
      return;
    }

    try {
      await ack();
      await runAcknowledgedWork("review_decision", async () => {
        const packet = await store.getReview(reviewId, body.team?.id);
        if (!packet) {
          await client.chat.postMessage({
            channel: body.user.id,
            text: "Review decision was not recorded because the packet was not found."
          });
          return;
        }
        if (!packet.artifactFingerprint) {
          await client.chat.postMessage({
            channel: body.user.id,
            text: "Legacy reviews cannot be approved. Run a new fingerprinted review."
          });
          return;
        }
        const updated = recordReviewDecision(packet, {
          status: status as "approved" | "changes_requested" | "warnings_accepted",
          rationale,
          decidedBy: body.user.id,
          decidedAt: new Date().toISOString(),
          artifactFingerprint: packet.artifactFingerprint
        });
        await store.saveReview(updated, {
          slackTeamId: body.team?.id,
          slackUserId: body.user.id
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: `Review decision recorded: ${status.replaceAll("_", " ")}.`
        });
        await postReviewRoom({
          client,
          channel: body.user.id,
          packet: updated,
          store,
          logger
        });
      }, logger);
    } catch (error) {
      logger("review_decision_ack_failed", {
        message: error instanceof Error ? error.message : "Decision could not be acknowledged."
      });
    }
  });

  app.view("securelore_lesson_submit", async ({ ack, body, view, client }) => {
    const reviewId = view.private_metadata;
    const lesson =
      view.state.values.lesson_block?.lesson_text?.value?.trim() ?? "";
    const kind =
      view.state.values.lesson_kind_block?.lesson_kind?.selected_option?.value ??
      "admin_evidence";

    if (!isReviewer(body.user.id)) {
      await ack({
        response_action: "errors",
        errors: {
          lesson_block: "Only a configured SecureLore reviewer can promote shared lessons."
        }
      });
      return;
    }

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
        if (!body.team?.id) {
          await client.chat.postMessage({
            channel: body.user.id,
            text: "SecureLore could not promote that lesson because the Slack workspace identity was missing."
          });
          return;
        }

        await withTimeout(
          policyContextProvider.promoteLearningExample({
            sourceReviewId: reviewId,
            slackTeamId: body.team.id,
            promotedBy: body.user.id,
            kind,
            content: sanitizeLearningLesson(lesson)
          }),
          10_000,
          "Lesson promotion exceeded 10000ms"
        );
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
    await runAcknowledgedWork("home_refresh", async () => {
      const reviewerMode = isReviewer(body.user.id);
      const reviews = await store.listRecentReviews({
        slackTeamId: context.teamId,
        slackUserId: reviewerMode ? undefined : body.user.id,
        limit: 10
      });
      await client.views.publish({
        user_id: body.user.id,
        view: {
          type: "home",
          blocks: renderAppHome(reviews, { reviewerMode })
        }
      });
    }, logger);
  });

  app.action("home_new_review", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await runAcknowledgedWork(
      "home_review_modal",
      () => client.views.open({ trigger_id: body.trigger_id, view: reviewModal() }),
      logger
    );
  });

  app.action("home_delete_data", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions" || !body.trigger_id) return;
    await runAcknowledgedWork(
      "delete_data_modal",
      () => client.views.open({ trigger_id: body.trigger_id, view: deleteDataModal() }),
      logger
    );
  });

  app.view("securelore_delete_data_submit", async ({ ack, body, view, client }) => {
    const confirmation = view.state.values.delete_confirmation_block?.delete_confirmation?.value?.trim();
    if (confirmation !== "DELETE") {
      await ack({
        response_action: "errors",
        errors: { delete_confirmation_block: "Type DELETE to remove your SecureLore review data." }
      });
      return;
    }
    if (!body.team?.id) {
      await ack({
        response_action: "errors",
        errors: { delete_confirmation_block: "Slack workspace identity was missing." }
      });
      return;
    }

    await ack();
    await runAcknowledgedWork("user_data_deletion", async () => {
      try {
        const deleted = await store.deleteUserData(body.team!.id, body.user.id);
        await client.chat.postMessage({
          channel: body.user.id,
          text: deleted
            ? "Your SecureLore review sessions, evidence, feedback, candidate evals, and promoted lessons were deleted."
            : "Persistent deletion is unavailable in local development mode. No production data was changed."
        });
      } catch (error) {
        logger("user_data_deletion_failed", {
          teamId: body.team!.id,
          userId: body.user.id,
          message: error instanceof Error ? error.message : "unknown"
        });
        await client.chat.postMessage({
          channel: body.user.id,
          text: "SecureLore could not delete your review data. No partial-success claim was recorded; contact the project owner with your workspace and user ID."
        });
      }
    }, logger);
  });

  app.action("home_open_room", async ({ ack, body, client }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const reviewId = getActionValue(body.actions[0]);
    await runAcknowledgedWork("home_open_room", async () => {
      const packet = await store.getReview(reviewId, body.team?.id);
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
    }, logger);
  });

  app.event("app_mention", async ({ event, say }) => {
    const mentionWork = !("text" in event) || !event.text?.toLowerCase().includes("review")
      ? say("Mention me with `review` or run `/securelore review`.")
      : say("Run `/securelore review` to paste a real Slack manifest or MCP tools/list response.");
    await retainSlackWork(mentionWork);
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

async function retainSlackWork(work: Promise<unknown>): Promise<void> {
  if (isVercel) {
    waitUntil(work);
    return;
  }
  await work;
}

async function runAcknowledgedWork(
  event: string,
  operation: () => Promise<unknown>,
  logger: ReturnType<typeof createRuntimeLogger>,
  onError?: () => Promise<unknown>
): Promise<void> {
  const work = operation().then(
    () => logger(`${event}_completed`),
    async (error) => {
      logger(`${event}_failed`, {
        code: error && typeof error === "object" && "code" in error ? error.code : "unknown",
        message: error instanceof Error ? error.message : "unknown"
      });
      if (onError) {
        try {
          await onError();
        } catch (fallbackError) {
          logger(`${event}_fallback_failed`, {
            message: fallbackError instanceof Error ? fallbackError.message : "unknown"
          });
        }
      }
    }
  );
  await retainSlackWork(work);
}

async function runBestEffort(
  event: string,
  operation: () => Promise<unknown>,
  logger: ReturnType<typeof createRuntimeLogger>,
  timeoutMs = 1_200
): Promise<void> {
  try {
    await withTimeout(operation(), timeoutMs, `${event} timed out`);
  } catch (error) {
    logger(`${event}_skipped`, {
      error: error instanceof Error ? error.message : "unknown"
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function enrichReviewPacketBestEffort(
  packet: ReviewPacket,
  logger: ReturnType<typeof createRuntimeLogger>,
  eventPrefix: string
): Promise<ReviewPacket> {
  try {
    return await withTimeout(
      enrichReviewPacket(packet, {
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL,
        timeoutMs: 10_000
      }),
      11_000,
      "OpenRouter enrichment exceeded 11000ms"
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "enrichment_failed";
    logger(`${eventPrefix}_enrichment_fallback`, { reason });
    return {
      ...packet,
      evalTrace: {
        ...packet.evalTrace,
        checks: [
          ...(packet.evalTrace?.checks ?? []),
          {
            name: "eve_openrouter_enrichment",
            status: "not_run",
            notes: `Deterministic review preserved because optional enrichment was unavailable: ${reason}`
          }
        ]
      }
    };
  }
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
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [redacted-token]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/\b((?:api[_ -]?key|client[_ -]?secret|signing[_ -]?secret))\s*[:=]\s*\S+/gi, "$1=[redacted-secret]")
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
  let evidence: Awaited<ReturnType<ReviewStore["listReviewEvidence"]>> = [];
  try {
    evidence = await withTimeout(
      options.store.listReviewEvidence(options.packet.reviewId, 5),
      3_000,
      "Review evidence lookup exceeded 3000ms"
    );
  } catch (error) {
    options.logger("review_room_evidence_unavailable", {
      reviewId: options.packet.reviewId,
      reason: error instanceof Error ? error.message : "lookup_failed"
    });
  }
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

function reviewModal(parentReviewId = "") {
  return {
    type: "modal" as const,
    callback_id: "securelore_review_submit",
    private_metadata: parentReviewId,
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
      },
      {
        type: "input" as const,
        block_id: "declared_features_block",
        optional: true,
        label: { type: "plain_text" as const, text: "User-visible features" },
        hint: { type: "plain_text" as const, text: "One tested feature per line. Keep this outside the Slack manifest." },
        element: {
          type: "plain_text_input" as const,
          action_id: "declared_features",
          multiline: true,
          max_length: 1600,
          placeholder: { type: "plain_text" as const, text: "Review uploaded JSON files\nSearch public workspace precedent" }
        }
      },
      {
        type: "input" as const,
        block_id: "public_pages_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Public app pages" },
        hint: { type: "plain_text" as const, text: "Use landing=, privacy=, and support= on separate lines." },
        element: {
          type: "plain_text_input" as const,
          action_id: "public_pages",
          multiline: true,
          max_length: 1200,
          placeholder: { type: "plain_text" as const, text: "landing=https://...\nprivacy=https://...\nsupport=https://..." }
        }
      },
      {
        type: "input" as const,
        block_id: "ai_model_block",
        optional: true,
        label: { type: "plain_text" as const, text: "AI provider and model" },
        element: {
          type: "plain_text_input" as const,
          action_id: "ai_model",
          max_length: 200,
          placeholder: { type: "plain_text" as const, text: "OpenRouter / openai/gpt-4o-mini" }
        }
      },
      {
        type: "input" as const,
        block_id: "ai_retention_block",
        optional: true,
        label: { type: "plain_text" as const, text: "AI data retention" },
        element: {
          type: "plain_text_input" as const,
          action_id: "ai_retention",
          multiline: true,
          max_length: 600,
          placeholder: { type: "plain_text" as const, text: "What is retained, where, and for how long?" }
        }
      },
      {
        type: "input" as const,
        block_id: "ai_training_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Model training use" },
        element: {
          type: "static_select" as const,
          action_id: "ai_training",
          placeholder: { type: "plain_text" as const, text: "Choose the disclosed behavior" },
          options: [
            {
              text: { type: "plain_text" as const, text: "Slack data is not used for training" },
              value: "Slack data is not used to train foundation models."
            },
            {
              text: { type: "plain_text" as const, text: "Training behavior is not documented" },
              value: "Training behavior is not documented."
            }
          ]
        }
      },
      {
        type: "input" as const,
        block_id: "scope_justifications_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Scope-to-feature mapping" },
        hint: { type: "plain_text" as const, text: "One `scope = tested feature and control` mapping per line." },
        element: {
          type: "plain_text_input" as const,
          action_id: "scope_justifications",
          multiline: true,
          max_length: 1800,
          placeholder: { type: "plain_text" as const, text: "files:read = user-triggered JSON review; content is not retained" }
        }
      },
      {
        type: "input" as const,
        block_id: "consequential_actions_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Consequential or write actions" },
        hint: { type: "plain_text" as const, text: "One action per line." },
        element: {
          type: "plain_text_input" as const,
          action_id: "consequential_actions",
          multiline: true,
          max_length: 1200,
          placeholder: { type: "plain_text" as const, text: "Create a support ticket\nPost an incident update" }
        }
      },
      {
        type: "input" as const,
        block_id: "human_review_controls_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Human review controls" },
        element: {
          type: "plain_text_input" as const,
          action_id: "human_review_controls",
          multiline: true,
          max_length: 800,
          placeholder: { type: "plain_text" as const, text: "Describe preview, confirmation, reviewer, and rollback controls." }
        }
      },
      {
        type: "input" as const,
        block_id: "runtime_evidence_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Runtime verification evidence" },
        hint: { type: "plain_text" as const, text: "kind | status | description | optional HTTPS reference" },
        element: {
          type: "plain_text_input" as const,
          action_id: "runtime_evidence",
          multiline: true,
          max_length: 1800,
          placeholder: {
            type: "plain_text" as const,
            text: "request_signing | verified | Unsigned requests return 401 | https://..."
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

export function lessonModal(reviewId: string) {
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
            text: "Example: Allow files:read only for visible, user-triggered review; document retention and never store Slack file content."
          }
        }
      }
    ]
  };
}

function decisionModal(reviewId: string) {
  return {
    type: "modal" as const,
    callback_id: "securelore_decision_submit",
    private_metadata: reviewId,
    title: { type: "plain_text" as const, text: "Review Decision" },
    submit: { type: "plain_text" as const, text: "Record" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "input" as const,
        block_id: "decision_status_block",
        label: { type: "plain_text" as const, text: "Decision" },
        element: {
          type: "static_select" as const,
          action_id: "decision_status",
          options: [
            {
              text: { type: "plain_text" as const, text: "Request changes" },
              value: "changes_requested"
            },
            {
              text: { type: "plain_text" as const, text: "Approve" },
              value: "approved"
            },
            {
              text: { type: "plain_text" as const, text: "Accept remaining warnings" },
              value: "warnings_accepted"
            }
          ]
        }
      },
      {
        type: "input" as const,
        block_id: "decision_rationale_block",
        label: { type: "plain_text" as const, text: "Rationale" },
        element: {
          type: "plain_text_input" as const,
          action_id: "decision_rationale",
          multiline: true,
          placeholder: {
            type: "plain_text" as const,
            text: "Explain the evidence, remaining risk, and required next action."
          }
        }
      }
    ]
  };
}

function deleteDataModal() {
  return {
    type: "modal" as const,
    callback_id: "securelore_delete_data_submit",
    title: { type: "plain_text" as const, text: "Delete review data" },
    submit: { type: "plain_text" as const, text: "Delete" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: "This permanently deletes your workspace-scoped review sessions, submitted evidence, feedback, candidate evals, and promoted lessons. This cannot be undone."
        }
      },
      {
        type: "input" as const,
        block_id: "delete_confirmation_block",
        label: { type: "plain_text" as const, text: "Type DELETE to confirm" },
        element: {
          type: "plain_text_input" as const,
          action_id: "delete_confirmation",
          placeholder: { type: "plain_text" as const, text: "DELETE" }
        }
      }
    ]
  };
}

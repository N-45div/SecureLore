import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "@slack/bolt";
import { reviewArtifacts } from "@securelore/review-core";
import type { McpToolsListLike, SlackManifestLike } from "@securelore/review-core";
import { renderReviewPacket } from "@securelore/slack-ui";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../..");
const socketMode = process.env.SLACK_SOCKET_MODE !== "false";

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
      text: "Use `/securelore review` to run the demo preflight review."
    });
    return;
  }

  const packet = await runDemoReview();
  await respond({
    response_type: "ephemeral",
    text: packet.overallRisk.summary,
    blocks: renderReviewPacket(packet)
  });
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

  const packet = await runDemoReview();
  await say({
    text: packet.overallRisk.summary,
    blocks: renderReviewPacket(packet)
  });
});

async function runDemoReview() {
  const [manifestRaw, toolsRaw] = await Promise.all([
    readFile(join(repoRoot, "artifacts/samples/bad-support-agent.manifest.json"), "utf8"),
    readFile(join(repoRoot, "artifacts/samples/bad-mcp-tools.json"), "utf8")
  ]);

  return reviewArtifacts({
    manifest: JSON.parse(manifestRaw) as SlackManifestLike,
    mcpTools: JSON.parse(toolsRaw) as McpToolsListLike,
    fixtureIds: ["sg-001-broad-history-scopes", "sg-004-mcp-vague-write-tool"]
  });
}

await app.start(Number(process.env.PORT ?? 3000));
console.log("SecureLore Slack app is running.");

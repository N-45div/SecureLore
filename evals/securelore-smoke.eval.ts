import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "SecureLore Eve agent can explain the review workflow.",
  async test(t) {
    await t.send("Explain what SecureLore reviews before a Slack agent is approved.");
    t.succeeded();
    t.check(t.reply, includes("Slack"));
    t.check(t.reply, includes("MCP"));
  }
});

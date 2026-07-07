import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { enrichReviewPacket } from "@securelore/agent-core";
import { reviewArtifacts } from "@securelore/review-core";

export default defineTool({
  description: "Review Slack app manifest JSON and optional MCP tools/list JSON, then enrich the packet with the Eve OpenRouter agent.",
  inputSchema: z.object({
    manifestJson: z.string().optional(),
    mcpToolsJson: z.string().optional()
  }),
  async execute({ manifestJson, mcpToolsJson }) {
    if (!manifestJson && !mcpToolsJson) {
      const sampleRoot = process.cwd();
      manifestJson = await readFile(
        join(sampleRoot, "artifacts/samples/bad-support-agent.manifest.json"),
        "utf8"
      );
    }

    const packet = reviewArtifacts({
      manifest: manifestJson ? JSON.parse(manifestJson) : undefined,
      mcpTools: mcpToolsJson ? JSON.parse(mcpToolsJson) : undefined
    });

    return enrichReviewPacket(packet, {
      openRouterApiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL
    });
  }
});

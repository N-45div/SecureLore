import { defineTool } from "eve/tools";
import { z } from "zod";
import { enrichReviewPacket } from "@securelore/agent-core";

export default defineTool({
  description: "Enrich an existing SecureLore review packet with Eve/OpenRouter reviewer notes and generated submission artifacts.",
  inputSchema: z.object({
    packet: z.record(z.string(), z.unknown())
  }),
  async execute({ packet }) {
    return enrichReviewPacket(packet as never, {
      openRouterApiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL
    });
  }
});

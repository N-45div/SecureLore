import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CohereEmbeddingProvider,
  NeonMemoryStore,
  PolicyMemory,
  requireEnv
} from "../src/index.js";
import type { PolicyChunk } from "../src/index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(currentDir, "../../../..");
const chunks = JSON.parse(
  await readFile(join(repoRoot, "db/seeds/policies/slack-marketplace.json"), "utf8")
) as PolicyChunk[];

const memory = new PolicyMemory(
  new NeonMemoryStore(requireEnv("DATABASE_URL")),
  new CohereEmbeddingProvider({
    apiKey: requireEnv("COHERE_API_KEY"),
    model: process.env.COHERE_EMBED_MODEL
  })
);

await memory.upsertChunks(chunks);
console.log(`Seeded ${chunks.length} policy chunks.`);

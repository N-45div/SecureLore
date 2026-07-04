import {
  CohereEmbeddingProvider,
  NeonMemoryStore,
  PolicyMemory,
  requireEnv
} from "../src/index.js";

const memory = new PolicyMemory(
  new NeonMemoryStore(requireEnv("DATABASE_URL")),
  new CohereEmbeddingProvider({ apiKey: requireEnv("COHERE_API_KEY") })
);

const results = await memory.retrieve(
  "The Slack app asks for files:read and channels:history but only says it answers support questions.",
  3
);

console.log(JSON.stringify(results, null, 2));

import {
  CohereEmbeddingProvider,
  NeonMemoryStore,
  PolicyMemory
} from "@securelore/memory";
import type { PolicyContext } from "@securelore/review-core";

export interface PolicyContextProvider {
  retrieve(query: string): Promise<PolicyContext[]>;
}

export class NoopPolicyContextProvider implements PolicyContextProvider {
  async retrieve(): Promise<PolicyContext[]> {
    return [];
  }
}

export class NeonCoherePolicyContextProvider implements PolicyContextProvider {
  private readonly memory: PolicyMemory;

  constructor(options: { databaseUrl: string; cohereApiKey: string }) {
    this.memory = new PolicyMemory(
      new NeonMemoryStore(options.databaseUrl),
      new CohereEmbeddingProvider({ apiKey: options.cohereApiKey })
    );
  }

  async retrieve(query: string): Promise<PolicyContext[]> {
    const chunks = await this.memory.retrieve(query, 5);
    return chunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sourceUrl: chunk.sourceUrl,
      similarity: chunk.similarity,
      excerpt: chunk.content,
      tags: chunk.tags
    }));
  }
}

export function createPolicyContextProvider(env: NodeJS.ProcessEnv): PolicyContextProvider {
  if (env.DATABASE_URL && env.COHERE_API_KEY) {
    return new NeonCoherePolicyContextProvider({
      databaseUrl: env.DATABASE_URL,
      cohereApiKey: env.COHERE_API_KEY
    });
  }

  return new NoopPolicyContextProvider();
}

import type { EmbeddingProvider } from "./cohere-embeddings.js";
import type { NeonMemoryStore } from "./neon-store.js";
import type { PolicyChunk, RetrievedPolicyChunk } from "./types.js";

export class PolicyMemory {
  constructor(
    private readonly store: NeonMemoryStore,
    private readonly embeddings: EmbeddingProvider
  ) {}

  async upsertChunks(chunks: PolicyChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const [embedding] = await this.embeddings.embedTexts(
        [`${chunk.title}\n${chunk.content}`],
        "search_document"
      );
      await this.store.upsertPolicyChunk(chunk, embedding);
    }
  }

  async retrieve(query: string, limit = 6): Promise<RetrievedPolicyChunk[]> {
    const [embedding] = await this.embeddings.embedTexts([query], "search_query");
    return this.store.retrievePolicyChunks(embedding, limit);
  }
}

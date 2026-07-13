import type { EmbeddingProvider } from "./cohere-embeddings.js";
import type { NeonMemoryStore } from "./neon-store.js";
import type {
  LearningExampleInput,
  PolicyChunk,
  RetrievedLearningExample,
  RetrievedPolicyChunk
} from "./types.js";

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

  async retrieveReviewContext(
    query: string,
    slackTeamId?: string,
    policyLimit = 5,
    learningLimit = 3
  ): Promise<{
    chunks: RetrievedPolicyChunk[];
    lessons: RetrievedLearningExample[];
  }> {
    const [embedding] = await this.embeddings.embedTexts([query], "search_query");
    const [chunks, lessons] = await Promise.all([
      this.store.retrievePolicyChunks(embedding, policyLimit),
      slackTeamId
        ? this.store.retrieveLearningExamples(embedding, slackTeamId, learningLimit)
        : Promise.resolve([])
    ]);

    return { chunks, lessons };
  }

  async promoteLearningExample(input: LearningExampleInput): Promise<void> {
    const [embedding] = await this.embeddings.embedTexts(
      [`${input.kind}\n${input.content}`],
      "search_document"
    );
    await this.store.saveLearningExample(input, embedding);
  }

  async retrieveLearningExamples(
    query: string,
    slackTeamId: string,
    limit = 3
  ): Promise<RetrievedLearningExample[]> {
    const [embedding] = await this.embeddings.embedTexts([query], "search_query");
    return this.store.retrieveLearningExamples(embedding, slackTeamId, limit);
  }
}

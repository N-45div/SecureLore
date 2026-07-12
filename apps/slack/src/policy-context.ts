import {
  CohereEmbeddingProvider,
  NeonMemoryStore,
  PolicyMemory
} from "@securelore/memory";
import type { LearningExampleInput } from "@securelore/memory";
import type { PolicyContext } from "@securelore/review-core";

export interface PolicyContextProvider {
  retrieve(query: string, slackTeamId?: string): Promise<PolicyContext[]>;
  promoteLearningExample?(input: LearningExampleInput): Promise<void>;
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

  async retrieve(query: string, slackTeamId?: string): Promise<PolicyContext[]> {
    const [chunks, lessons] = await Promise.all([
      this.memory.retrieve(query, 5),
      slackTeamId ? this.memory.retrieveLearningExamples(query, slackTeamId, 3) : []
    ]);
    return [
      ...chunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sourceUrl: chunk.sourceUrl,
      similarity: chunk.similarity,
      excerpt: chunk.content,
      tags: chunk.tags
      })),
      ...lessons.map((lesson) => ({
        id: `learning:${lesson.id}`,
        title: `Learned review lesson: ${lesson.kind}`,
        source: "securelore-learning",
        similarity: lesson.similarity,
        excerpt: lesson.content,
        tags: [
          "learned",
          lesson.kind,
          `promoted-by:${lesson.promotedBy}`,
          ...(lesson.sourceReviewId ? [lesson.sourceReviewId] : [])
        ]
      }))
    ];
  }

  async promoteLearningExample(input: LearningExampleInput): Promise<void> {
    await this.memory.promoteLearningExample(input);
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

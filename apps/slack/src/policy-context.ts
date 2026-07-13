import {
  CohereEmbeddingProvider,
  NeonMemoryStore,
  PolicyMemory
} from "@securelore/memory";
import type { LearningExampleInput } from "@securelore/memory";
import type { PolicyContext } from "@securelore/review-core";

const DEFAULT_RETRIEVAL_TIMEOUT_MS = 6_000;

const canonicalPolicyContext: PolicyContext[] = [
  {
    id: "slack-marketplace.scope-data-access",
    source: "Slack Marketplace guidelines",
    sourceUrl: "https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/",
    title: "Scope and data access review",
    excerpt: "Slack Marketplace apps should follow least privilege. Broad workspace message or file access needs a clear tested use case, and every submitted scope should map to functionality reviewers can test.",
    tags: ["slack", "marketplace", "scopes", "least-privilege"]
  },
  {
    id: "slack-marketplace.public-pages",
    source: "Slack Marketplace guidelines",
    sourceUrl: "https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/",
    title: "Public landing, support, and privacy pages",
    excerpt: "A Slack app should provide public landing, support, and privacy pages covering installation, contact, collected data, use, retention, and deletion.",
    tags: ["slack", "marketplace", "privacy", "support", "landing-page"]
  },
  {
    id: "slack-marketplace.ai-components",
    source: "Slack Marketplace guidelines",
    sourceUrl: "https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/",
    title: "AI component disclosures",
    excerpt: "Slack apps exposing generative AI should disclose model use, retention, data tenancy and residency where relevant, and whether user data is used by the LLM. Slack data must not train large language models.",
    tags: ["slack", "marketplace", "ai", "disclosure", "llm"]
  },
  {
    id: "slack-marketplace.security-tls",
    source: "Slack Marketplace guidelines",
    sourceUrl: "https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/",
    title: "Security and TLS",
    excerpt: "Slack command, event, and interactivity endpoints should verify request authenticity and use production TLS endpoints rather than localhost or unsecured HTTP URLs.",
    tags: ["slack", "marketplace", "security", "tls", "https"]
  },
  {
    id: "slack-mcp.tool-discovery",
    source: "Slack MCP distribution guidance",
    sourceUrl: "https://docs.slack.dev/ai/slackbot-mcp-client/distributing/",
    title: "MCP tool discovery and metadata",
    excerpt: "MCP tools should have accurate names, descriptions, schemas, and annotations. A tool that mutates state or triggers external effects must not be marked read-only.",
    tags: ["slack", "mcp", "tools", "readOnlyHint", "schemas"]
  },
  {
    id: "slack-marketplace.ai-human-review",
    source: "Slack Marketplace guidelines",
    sourceUrl: "https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/",
    title: "AI output and human review",
    excerpt: "Generative AI output may be inaccurate and must not make consequential decisions without human review. Recommendations should retain evidence for an administrator's decision.",
    tags: ["slack", "ai", "human-review", "governance"]
  }
];

type PolicyContextLogger = (event: string, fields?: Record<string, unknown>) => void;

export interface PolicyContextProvider {
  retrieve(query: string, slackTeamId?: string): Promise<PolicyContext[]>;
  promoteLearningExample?(input: LearningExampleInput): Promise<void>;
}

export class CanonicalPolicyContextProvider implements PolicyContextProvider {
  async retrieve(query: string): Promise<PolicyContext[]> {
    return selectCanonicalPolicyContext(query);
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
    const { chunks, lessons } = await this.memory.retrieveReviewContext(query, slackTeamId, 5, 3);
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

export class ResilientPolicyContextProvider implements PolicyContextProvider {
  constructor(
    private readonly provider: PolicyContextProvider,
    private readonly options: {
      timeoutMs?: number;
      logger?: PolicyContextLogger;
    } = {}
  ) {}

  async retrieve(query: string, slackTeamId?: string): Promise<PolicyContext[]> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
    try {
      const context = await withTimeout(
        this.provider.retrieve(query, slackTeamId),
        timeoutMs,
        `Policy memory retrieval exceeded ${timeoutMs}ms`
      );
      if (context.length > 0) {
        this.options.logger?.("policy_memory_retrieved", {
          count: context.length,
          includesLearning: context.some((item) => item.id.startsWith("learning:"))
        });
        return context;
      }

      this.options.logger?.("policy_memory_fallback", {
        reason: "empty_result"
      });
    } catch (error) {
      this.options.logger?.("policy_memory_fallback", {
        reason: error instanceof Error ? error.message : "retrieval_failed"
      });
    }

    return selectCanonicalPolicyContext(query);
  }

  async promoteLearningExample(input: LearningExampleInput): Promise<void> {
    if (!this.provider.promoteLearningExample) return;
    await this.provider.promoteLearningExample(input);
  }
}

export function createPolicyContextProvider(
  env: NodeJS.ProcessEnv,
  options: { logger?: PolicyContextLogger; timeoutMs?: number } = {}
): PolicyContextProvider {
  if (env.DATABASE_URL && env.COHERE_API_KEY) {
    return new ResilientPolicyContextProvider(
      new NeonCoherePolicyContextProvider({
        databaseUrl: env.DATABASE_URL,
        cohereApiKey: env.COHERE_API_KEY
      }),
      options
    );
  }

  return new CanonicalPolicyContextProvider();
}

export function selectCanonicalPolicyContext(query: string, limit = 5): PolicyContext[] {
  const queryTerms = new Set(tokenize(query));
  return canonicalPolicyContext
    .map((policy, index) => ({
      policy,
      index,
      score: tokenize([
        policy.id,
        policy.title,
        policy.excerpt,
        ...(policy.tags ?? [])
      ].join(" ")).reduce((score, term) => score + (queryTerms.has(term) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ policy }) => ({ ...policy, tags: [...(policy.tags ?? [])] }));
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9:-]+/g) ?? [];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

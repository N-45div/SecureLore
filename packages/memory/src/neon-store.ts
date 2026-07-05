import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  FeedbackPersistenceInput,
  PolicyChunk,
  RetrievedPolicyChunk,
  ReviewPersistenceInput,
  ReviewSummary
} from "./types.js";
import type { ReviewPacket } from "@securelore/review-core";
import { vectorLiteral } from "./vector.js";

export class NeonMemoryStore {
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async upsertPolicyChunk(chunk: PolicyChunk, embedding: number[]): Promise<void> {
    await this.sql`
      INSERT INTO policy_chunks (id, source, source_url, title, content, tags, embedding)
      VALUES (
        ${chunk.id},
        ${chunk.source},
        ${chunk.sourceUrl ?? null},
        ${chunk.title},
        ${chunk.content},
        ${chunk.tags},
        ${vectorLiteral(embedding)}::vector
      )
      ON CONFLICT (id) DO UPDATE SET
        source = EXCLUDED.source,
        source_url = EXCLUDED.source_url,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        embedding = EXCLUDED.embedding,
        updated_at = now()
    `;
  }

  async retrievePolicyChunks(queryEmbedding: number[], limit = 6): Promise<RetrievedPolicyChunk[]> {
    const rows = await this.sql`
      SELECT
        id,
        source,
        source_url,
        title,
        content,
        tags,
        1 - (embedding <=> ${vectorLiteral(queryEmbedding)}::vector) AS similarity
      FROM policy_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral(queryEmbedding)}::vector
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      sourceUrl: row.source_url ? String(row.source_url) : undefined,
      title: String(row.title),
      content: String(row.content),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      similarity: Number(row.similarity)
    }));
  }

  async saveReview(input: ReviewPersistenceInput): Promise<void> {
    await this.sql`
      INSERT INTO review_sessions (
        id,
        slack_team_id,
        slack_channel_id,
        slack_user_id,
        grade,
        summary,
        packet
      )
      VALUES (
        ${input.packet.reviewId},
        ${input.slackTeamId ?? null},
        ${input.slackChannelId ?? null},
        ${input.slackUserId ?? null},
        ${input.packet.overallRisk.grade},
        ${input.packet.overallRisk.summary},
        ${JSON.stringify(input.packet)}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        grade = EXCLUDED.grade,
        summary = EXCLUDED.summary,
        packet = EXCLUDED.packet
    `;
  }

  async saveFeedback(input: FeedbackPersistenceInput): Promise<void> {
    await this.sql`
      INSERT INTO feedback_events (review_id, action_id, slack_user_id, slack_channel_id)
      VALUES (
        ${input.reviewId},
        ${input.actionId},
        ${input.slackUserId ?? null},
        ${input.slackChannelId ?? null}
      )
    `;
  }

  async getReview(reviewId: string): Promise<ReviewPacket | null> {
    const rows = await this.sql`
      SELECT packet
      FROM review_sessions
      WHERE id = ${reviewId}
      LIMIT 1
    `;

    if (rows.length === 0) return null;
    return rows[0].packet as ReviewPacket;
  }

  async listRecentReviews(options?: {
    slackTeamId?: string;
    slackUserId?: string;
    limit?: number;
  }): Promise<ReviewSummary[]> {
    const limit = options?.limit ?? 10;
    const rows = await this.sql`
      SELECT
        id,
        grade,
        summary,
        packet,
        created_at
      FROM review_sessions
      WHERE (${options?.slackTeamId ?? null}::text IS NULL OR slack_team_id = ${options?.slackTeamId ?? null})
        AND (${options?.slackUserId ?? null}::text IS NULL OR slack_user_id = ${options?.slackUserId ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => {
      const packet = row.packet as {
        findings?: Array<{ severity?: string }>;
        inputSummary?: { artifactTypes?: string[] };
      };
      const findings = packet.findings ?? [];
      return {
        id: String(row.id),
        grade: String(row.grade),
        summary: String(row.summary),
        blockerCount: findings.filter((finding) => finding.severity === "blocker").length,
        warningCount: findings.filter((finding) => finding.severity === "warn").length,
        artifactTypes: packet.inputSummary?.artifactTypes ?? [],
        createdAt: new Date(String(row.created_at)).toISOString()
      };
    });
  }
}

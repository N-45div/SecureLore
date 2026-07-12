import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  EvalCaseInput,
  FeedbackPersistenceInput,
  LearningExampleInput,
  PolicyChunk,
  RetrievedPolicyChunk,
  RetrievedLearningExample,
  ReviewEvidenceInput,
  ReviewPersistenceInput,
  ReviewSummary,
  StoredReviewEvidence
} from "./types.js";
import type { ReviewPacket } from "@securelore/review-core";
import { vectorLiteral } from "./vector.js";

export class NeonMemoryStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private learningSchemaReady?: Promise<void>;

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
      ORDER BY ((embedding <=> ${vectorLiteral(queryEmbedding)}::vector) + 0)
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

  async saveLearningExample(input: LearningExampleInput, embedding: number[]): Promise<void> {
    await this.ensureLearningSchema();
    await this.sql`
      INSERT INTO learning_examples (
        source_review_id,
        slack_team_id,
        promoted_by,
        kind,
        content,
        embedding
      )
      VALUES (
        ${input.sourceReviewId ?? null},
        ${input.slackTeamId},
        ${input.promotedBy},
        ${input.kind},
        ${input.content},
        ${vectorLiteral(embedding)}::vector
      )
    `;
  }

  async retrieveLearningExamples(
    queryEmbedding: number[],
    slackTeamId: string,
    limit = 3
  ): Promise<RetrievedLearningExample[]> {
    await this.ensureLearningSchema();
    const rows = await this.sql`
      SELECT
        id,
        source_review_id,
        slack_team_id,
        promoted_by,
        kind,
        content,
        1 - (embedding <=> ${vectorLiteral(queryEmbedding)}::vector) AS similarity
      FROM learning_examples
      WHERE embedding IS NOT NULL
        AND slack_team_id = ${slackTeamId}
      ORDER BY ((embedding <=> ${vectorLiteral(queryEmbedding)}::vector) + 0)
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: String(row.id),
      sourceReviewId: row.source_review_id ? String(row.source_review_id) : undefined,
      slackTeamId: String(row.slack_team_id),
      promotedBy: String(row.promoted_by),
      kind: String(row.kind),
      content: String(row.content),
      similarity: Number(row.similarity)
    }));
  }

  private ensureLearningSchema(): Promise<void> {
    if (!this.learningSchemaReady) {
      this.learningSchemaReady = (async () => {
        await this.sql`ALTER TABLE learning_examples ADD COLUMN IF NOT EXISTS slack_team_id TEXT`;
        await this.sql`ALTER TABLE learning_examples ADD COLUMN IF NOT EXISTS promoted_by TEXT`;
        await this.sql`
          CREATE INDEX IF NOT EXISTS learning_examples_team_idx
          ON learning_examples (slack_team_id, created_at DESC)
        `;
      })();
    }
    return this.learningSchemaReady;
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

  async saveEvalCase(input: EvalCaseInput): Promise<void> {
    await this.sql`
      INSERT INTO eval_cases (id, source_review_id, task, input, expected, status)
      VALUES (
        ${input.id},
        ${input.sourceReviewId},
        ${input.task},
        ${JSON.stringify(input.input)}::jsonb,
        ${JSON.stringify(input.expected)}::jsonb,
        ${input.status ?? "candidate"}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async saveReviewEvidence(input: ReviewEvidenceInput): Promise<void> {
    await this.sql`
      INSERT INTO review_artifacts (review_id, artifact_type, content)
      VALUES (
        ${input.reviewId},
        'review_evidence',
        ${JSON.stringify({
          questionId: input.questionId,
          evidence: input.evidence,
          slackUserId: input.slackUserId,
          createdAt: new Date().toISOString()
        })}::jsonb
      )
    `;
  }

  async countReviewEvidence(reviewId: string): Promise<number> {
    const rows = await this.sql`
      SELECT count(*)::int AS count
      FROM review_artifacts
      WHERE review_id = ${reviewId}
        AND artifact_type = 'review_evidence'
    `;

    return Number(rows[0]?.count ?? 0);
  }

  async listReviewEvidence(reviewId: string, limit = 5): Promise<StoredReviewEvidence[]> {
    const rows = await this.sql`
      SELECT content, created_at
      FROM review_artifacts
      WHERE review_id = ${reviewId}
        AND artifact_type = 'review_evidence'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => {
      const content = row.content as {
        questionId?: string;
        evidence?: string;
        slackUserId?: string;
        createdAt?: string;
      };
      return {
        reviewId,
        questionId: content.questionId,
        evidence: String(content.evidence ?? ""),
        slackUserId: content.slackUserId,
        createdAt: content.createdAt ?? new Date(String(row.created_at)).toISOString()
      };
    });
  }

  async getReview(reviewId: string, slackTeamId?: string): Promise<ReviewPacket | null> {
    const rows = await this.sql`
      SELECT packet
      FROM review_sessions
      WHERE id = ${reviewId}
        AND (${slackTeamId ?? null}::text IS NULL OR slack_team_id = ${slackTeamId ?? null})
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
        created_at,
        (
          SELECT count(*)::int
          FROM review_artifacts
          WHERE review_artifacts.review_id = review_sessions.id
            AND review_artifacts.artifact_type = 'review_evidence'
        ) AS evidence_count
      FROM review_sessions
      WHERE (${options?.slackTeamId ?? null}::text IS NULL OR slack_team_id = ${options?.slackTeamId ?? null})
        AND (${options?.slackUserId ?? null}::text IS NULL OR slack_user_id = ${options?.slackUserId ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => {
      const packet = row.packet as {
        findings?: Array<{
          severity?: string;
          resolution?: { status?: string };
        }>;
        inputSummary?: { artifactTypes?: string[] };
        decision?: { status?: string };
      };
      const findings = (packet.findings ?? []).filter((finding) =>
        finding.resolution?.status !== "resolved" &&
        finding.resolution?.status !== "accepted_risk"
      );
      return {
        id: String(row.id),
        grade: String(row.grade),
        summary: String(row.summary),
        blockerCount: findings.filter((finding) => finding.severity === "blocker").length,
        warningCount: findings.filter((finding) => finding.severity === "warn").length,
        evidenceCount: Number(row.evidence_count ?? 0),
        artifactTypes: packet.inputSummary?.artifactTypes ?? [],
        decisionStatus: packet.decision?.status,
        createdAt: new Date(String(row.created_at)).toISOString()
      };
    });
  }
}

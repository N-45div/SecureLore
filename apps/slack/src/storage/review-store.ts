import type { ReviewPacket } from "@securelore/review-core";
import { NeonMemoryStore, type ReviewSummary } from "@securelore/memory";
import { LocalStore, type FeedbackEvent, type ReviewEvidenceEvent } from "./local-store.js";

export class ReviewStore {
  private readonly local?: LocalStore;
  private readonly neon?: NeonMemoryStore;

  constructor(options: { local?: LocalStore; databaseUrl?: string }) {
    this.local = options.local;
    this.neon = options.databaseUrl ? new NeonMemoryStore(options.databaseUrl) : undefined;

    if (!this.neon && !this.local) {
      throw new Error("ReviewStore requires DATABASE_URL or a local store.");
    }
  }

  async saveReview(packet: ReviewPacket, context?: {
    slackTeamId?: string;
    slackChannelId?: string;
    slackUserId?: string;
  }): Promise<void> {
    if (this.neon) {
      await this.neon.saveReview({
        packet,
        slackTeamId: context?.slackTeamId,
        slackChannelId: context?.slackChannelId,
        slackUserId: context?.slackUserId
      });
      return;
    }

    await this.local?.saveReview(packet);
  }

  async appendFeedback(event: FeedbackEvent): Promise<void> {
    if (this.neon) {
      await this.neon.saveFeedback({
        reviewId: event.reviewId,
        actionId: event.actionId,
        slackUserId: event.userId,
        slackChannelId: event.channelId
      });
      return;
    }

    await this.local?.appendFeedback(event);
  }

  async appendReviewEvidence(event: ReviewEvidenceEvent): Promise<void> {
    if (this.neon) {
      await this.neon.saveReviewEvidence({
        reviewId: event.reviewId,
        questionId: event.questionId,
        evidence: event.evidence,
        slackUserId: event.userId
      });
      return;
    }

    await this.local?.appendReviewEvidence(event);
  }

  async countReviewEvidence(reviewId: string): Promise<number> {
    if (this.neon) {
      return this.neon.countReviewEvidence(reviewId);
    }

    return 0;
  }

  async getReview(reviewId: string): Promise<ReviewPacket | null> {
    if (this.neon) {
      const packet = await this.neon.getReview(reviewId);
      if (packet) return packet;
    }

    return this.local?.getReview(reviewId) ?? null;
  }

  async listRecentReviews(options?: {
    slackTeamId?: string;
    slackUserId?: string;
    limit?: number;
  }): Promise<ReviewSummary[]> {
    if (this.neon) {
      return this.neon.listRecentReviews(options);
    }

    return this.local?.listRecentReviews(options?.limit) ?? [];
  }
}

import type { ReviewPacket } from "@securelore/review-core";
import { NeonMemoryStore, type ReviewSummary } from "@securelore/memory";
import { LocalStore, type FeedbackEvent } from "./local-store.js";

export class ReviewStore {
  private readonly local: LocalStore;
  private readonly neon?: NeonMemoryStore;

  constructor(options: { local: LocalStore; databaseUrl?: string }) {
    this.local = options.local;
    this.neon = options.databaseUrl ? new NeonMemoryStore(options.databaseUrl) : undefined;
  }

  async saveReview(packet: ReviewPacket, context?: {
    slackTeamId?: string;
    slackChannelId?: string;
    slackUserId?: string;
  }): Promise<void> {
    await this.local.saveReview(packet);
    if (this.neon) {
      await this.neon.saveReview({
        packet,
        slackTeamId: context?.slackTeamId,
        slackChannelId: context?.slackChannelId,
        slackUserId: context?.slackUserId
      });
    }
  }

  async appendFeedback(event: FeedbackEvent): Promise<void> {
    await this.local.appendFeedback(event);
    if (this.neon) {
      await this.neon.saveFeedback({
        reviewId: event.reviewId,
        actionId: event.actionId,
        slackUserId: event.userId,
        slackChannelId: event.channelId
      });
    }
  }

  async getReview(reviewId: string): Promise<ReviewPacket | null> {
    if (this.neon) {
      const packet = await this.neon.getReview(reviewId);
      if (packet) return packet;
    }

    return this.local.getReview(reviewId);
  }

  async listRecentReviews(options?: {
    slackTeamId?: string;
    slackUserId?: string;
    limit?: number;
  }): Promise<ReviewSummary[]> {
    if (this.neon) {
      return this.neon.listRecentReviews(options);
    }

    return this.local.listRecentReviews(options?.limit);
  }
}

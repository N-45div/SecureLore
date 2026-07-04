import type { ReviewPacket } from "@securelore/review-core";
import { NeonMemoryStore } from "@securelore/memory";
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
}

import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewPacket } from "@securelore/review-core";

export interface FeedbackEvent {
  reviewId: string;
  actionId: string;
  userId: string;
  channelId?: string;
  createdAt: string;
}

export class LocalStore {
  constructor(private readonly dataDir: string) {}

  async saveReview(packet: ReviewPacket): Promise<void> {
    await mkdir(join(this.dataDir, "reviews"), { recursive: true });
    await writeFile(
      join(this.dataDir, "reviews", `${packet.reviewId}.json`),
      `${JSON.stringify(packet, null, 2)}\n`,
      "utf8"
    );
  }

  async appendFeedback(event: FeedbackEvent): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await appendFile(
      join(this.dataDir, "feedback.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf8"
    );
  }
}

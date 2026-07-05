import { mkdir, writeFile, appendFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewPacket } from "@securelore/review-core";
import type { ReviewSummary } from "@securelore/memory";

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

  async listRecentReviews(limit = 10): Promise<ReviewSummary[]> {
    const reviewsDir = join(this.dataDir, "reviews");
    let filenames: string[];
    try {
      filenames = await readdir(reviewsDir);
    } catch {
      return [];
    }

    const packets = await Promise.all(
      filenames
        .filter((filename) => filename.endsWith(".json"))
        .map(async (filename) => {
          const raw = await readFile(join(reviewsDir, filename), "utf8");
          return JSON.parse(raw) as ReviewPacket;
        })
    );

    return packets
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
      .map((packet) => ({
        id: packet.reviewId,
        grade: packet.overallRisk.grade,
        summary: packet.overallRisk.summary,
        blockerCount: packet.findings.filter((finding) => finding.severity === "blocker").length,
        warningCount: packet.findings.filter((finding) => finding.severity === "warn").length,
        artifactTypes: packet.inputSummary.artifactTypes,
        createdAt: packet.createdAt
      }));
  }
}

import type { ReviewPacket } from "@securelore/review-core";

export interface PolicyChunk {
  id: string;
  source: string;
  sourceUrl?: string;
  title: string;
  content: string;
  tags: string[];
}

export interface RetrievedPolicyChunk extends PolicyChunk {
  similarity: number;
}

export interface ReviewPersistenceInput {
  packet: ReviewPacket;
  slackTeamId?: string;
  slackChannelId?: string;
  slackUserId?: string;
}

export interface FeedbackPersistenceInput {
  reviewId: string;
  actionId: string;
  slackUserId?: string;
  slackChannelId?: string;
}

export interface ReviewSummary {
  id: string;
  grade: string;
  summary: string;
  blockerCount: number;
  warningCount: number;
  artifactTypes: string[];
  createdAt: string;
}

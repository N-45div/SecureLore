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

export interface ReviewEvidenceInput {
  reviewId: string;
  questionId?: string;
  evidence: string;
  slackUserId?: string;
}

export interface LearningExampleInput {
  sourceReviewId?: string;
  kind: string;
  content: string;
}

export interface RetrievedLearningExample {
  id: string;
  sourceReviewId?: string;
  kind: string;
  content: string;
  similarity: number;
}

export interface ReviewSummary {
  id: string;
  grade: string;
  summary: string;
  blockerCount: number;
  warningCount: number;
  evidenceCount: number;
  artifactTypes: string[];
  createdAt: string;
}

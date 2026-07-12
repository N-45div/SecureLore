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

export interface EvalCaseInput {
  id: string;
  sourceReviewId: string;
  task: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  status?: "candidate" | "approved" | "rejected";
}

export interface ReviewEvidenceInput {
  reviewId: string;
  questionId?: string;
  evidence: string;
  slackUserId?: string;
}

export interface StoredReviewEvidence {
  reviewId: string;
  questionId?: string;
  evidence: string;
  slackUserId?: string;
  createdAt: string;
}

export interface LearningExampleInput {
  sourceReviewId?: string;
  slackTeamId: string;
  promotedBy: string;
  kind: string;
  content: string;
}

export interface RetrievedLearningExample {
  id: string;
  sourceReviewId?: string;
  slackTeamId: string;
  promotedBy: string;
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
  decisionStatus?: string;
  approvalState?: string;
  artifactFingerprint?: string;
  createdAt: string;
}

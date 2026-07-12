CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS policy_chunks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_chunks_embedding_idx
  ON policy_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY,
  slack_team_id TEXT,
  slack_channel_id TEXT,
  slack_user_id TEXT,
  grade TEXT NOT NULL,
  summary TEXT NOT NULL,
  packet JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  action_id TEXT NOT NULL,
  slack_user_id TEXT,
  slack_channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  source_review_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  input JSONB NOT NULL,
  expected JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_review_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  slack_team_id TEXT,
  promoted_by TEXT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE learning_examples ADD COLUMN IF NOT EXISTS slack_team_id TEXT;
ALTER TABLE learning_examples ADD COLUMN IF NOT EXISTS promoted_by TEXT;

CREATE INDEX IF NOT EXISTS learning_examples_team_idx
  ON learning_examples (slack_team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS learning_examples_embedding_idx
  ON learning_examples
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

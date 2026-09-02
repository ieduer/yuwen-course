CREATE TABLE IF NOT EXISTS learning_pending_submissions (
  source_event_id TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL,
  client_mutation_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  interaction_key TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured', 'retryable', 'completed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(student_id, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_pending_submissions_owner_status
  ON learning_pending_submissions(student_id, status, updated_at);

-- 0003 學習互動 → 過程評價閉環 v1
--
-- 原則：
-- 1. 語文站保存可追溯的原始互動；User Center 只接收最小化評價投影。
-- 2. 身分、題目版本、正誤、得分、嘗試序號和 A+ 資格均由服務端確定。
-- 3. 舊 submissions / vocab_attempts / site_progress 歷史資料原樣保留，不回填為受信證據。

ALTER TABLE students ADD COLUMN uc_user_id INTEGER;
ALTER TABLE students ADD COLUMN identity_verified_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_uc_user_id
  ON students(uc_user_id) WHERE uc_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS learning_interactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id       TEXT    NOT NULL UNIQUE,
  student_id            INTEGER NOT NULL REFERENCES students(id),
  uc_user_id            INTEGER,
  academic_year         TEXT    NOT NULL,
  lesson_id             TEXT    NOT NULL,
  interaction_key       TEXT    NOT NULL,
  event_type            TEXT    NOT NULL,
  assessment_kind       TEXT    NOT NULL,
  scoring_role          TEXT    NOT NULL,
  resource_key          TEXT    NOT NULL DEFAULT '',
  resource_version      TEXT    NOT NULL DEFAULT '',
  registry_version      TEXT    NOT NULL,
  class_session_id      TEXT    NOT NULL DEFAULT '',
  lesson_phase          TEXT    NOT NULL DEFAULT '',
  attempt_no            INTEGER NOT NULL DEFAULT 1,
  client_mutation_id    TEXT    NOT NULL DEFAULT '',
  raw_payload_json      TEXT    NOT NULL DEFAULT '{}',
  occurred_at           TEXT    NOT NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_interactions_client_mutation
  ON learning_interactions(student_id, client_mutation_id)
  WHERE client_mutation_id != '';

CREATE INDEX IF NOT EXISTS idx_learning_interactions_student_year
  ON learning_interactions(student_id, academic_year, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_interactions_resource_attempt
  ON learning_interactions(student_id, resource_key, interaction_key, attempt_no DESC);

CREATE TABLE IF NOT EXISTS learning_evaluations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id       TEXT    NOT NULL UNIQUE REFERENCES learning_interactions(source_event_id),
  verification_method   TEXT    NOT NULL,
  eligibility_status    TEXT    NOT NULL,
  raw_value              REAL,
  max_value              REAL,
  normalized_value       REAL,
  correctness            TEXT    NOT NULL DEFAULT 'not_applicable',
  evaluation_json        TEXT    NOT NULL DEFAULT '{}',
  evaluated_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_outbox (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id       TEXT    NOT NULL UNIQUE REFERENCES learning_interactions(source_event_id),
  envelope_json         TEXT    NOT NULL,
  delivery_status       TEXT    NOT NULL DEFAULT 'pending',
  delivery_attempts     INTEGER NOT NULL DEFAULT 0,
  last_error_class      TEXT    NOT NULL DEFAULT '',
  last_attempt_at       TEXT,
  delivered_at          TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_outbox_pending
  ON evidence_outbox(delivery_status, created_at);

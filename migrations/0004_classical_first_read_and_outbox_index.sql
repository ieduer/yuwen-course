-- 0004 古文無標點初讀過程記錄 + outbox 重試索引修正
--
-- 原則：
-- 1. 學生原始標記、猜測、訂正與初讀總結只保存在 YW 來源 D1。
-- 2. offset 永遠綁定 text_version_id / text_digest / paragraph_key；正文版本改變後不跨版套用。
-- 3. 初讀提交後原始猜測不可覆寫；細讀只新增藍筆訂正狀態。
-- 4. 刪除標記採 tombstone，保留過程稽核與歷史統計。

CREATE TABLE IF NOT EXISTS classical_first_read_sessions (
  student_id       INTEGER NOT NULL REFERENCES students(id),
  lesson_id        TEXT    NOT NULL,
  text_version_id  TEXT    NOT NULL,
  text_digest      TEXT    NOT NULL,
  started_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT    NOT NULL DEFAULT (datetime('now')),
  elapsed_ms       INTEGER NOT NULL DEFAULT 0,
  summary_text     TEXT    NOT NULL DEFAULT '',
  submitted_at     TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, lesson_id, text_version_id)
);

CREATE INDEX IF NOT EXISTS idx_classical_first_read_sessions_lesson
  ON classical_first_read_sessions(lesson_id, text_version_id, submitted_at);

CREATE TABLE IF NOT EXISTS classical_first_read_marks (
  mark_id          TEXT    PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES students(id),
  lesson_id        TEXT    NOT NULL,
  text_version_id  TEXT    NOT NULL,
  text_digest      TEXT    NOT NULL,
  paragraph_key    TEXT    NOT NULL,
  start_offset     INTEGER NOT NULL,
  end_offset       INTEGER NOT NULL,
  selected_text    TEXT    NOT NULL,
  context_before   TEXT    NOT NULL DEFAULT '',
  context_after    TEXT    NOT NULL DEFAULT '',
  guess_text       TEXT    NOT NULL DEFAULT '',
  correction_text  TEXT    NOT NULL DEFAULT '',
  resolution_status TEXT  NOT NULL DEFAULT 'open',
  client_mutation_id TEXT  NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT,
  UNIQUE (
    student_id,
    lesson_id,
    text_version_id,
    paragraph_key,
    start_offset,
    end_offset,
    selected_text
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_classical_first_read_marks_mutation
  ON classical_first_read_marks(student_id, client_mutation_id)
  WHERE client_mutation_id != '';

CREATE INDEX IF NOT EXISTS idx_classical_first_read_marks_state
  ON classical_first_read_marks(student_id, lesson_id, text_version_id, deleted_at, resolution_status);

-- retryPendingEvidence 以 delivery_status 篩選並按 id 排序；索引必須匹配查詢順序。
CREATE INDEX IF NOT EXISTS idx_evidence_outbox_pending_id
  ON evidence_outbox(delivery_status, id);

-- 星圖以每篇最新一次「有意思程度」回讀；題目增刪不影響此篇目級索引。
CREATE INDEX IF NOT EXISTS idx_learning_interactions_student_kind_lesson_id
  ON learning_interactions(student_id, interaction_key, lesson_id, id DESC);

-- 作答與證據同批寫入；兩個併發請求只能取得一個嘗試序號。
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_interactions_attempt_unique
  ON learning_interactions(student_id, resource_key, interaction_key, attempt_no);

ALTER TABLE vocab_attempts ADD COLUMN client_mutation_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_attempts_mutation_unique
  ON vocab_attempts(student_id, client_mutation_id)
  WHERE client_mutation_id != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_attempts_attempt_unique
  ON vocab_attempts(student_id, lesson_id, item_id, attempt_no);

CREATE TABLE IF NOT EXISTS learning_submission_slots (
  source_event_id   TEXT    PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES students(id),
  resource_key      TEXT    NOT NULL,
  window_start      TEXT    NOT NULL,
  resource_slot_no  INTEGER NOT NULL,
  global_slot_no    INTEGER NOT NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, resource_key, window_start, resource_slot_no),
  UNIQUE (student_id, window_start, global_slot_no)
);

CREATE INDEX IF NOT EXISTS idx_learning_submission_slots_window
  ON learning_submission_slots(student_id, window_start, resource_key);

-- 只有經 User Center service binding 驗證的穩定 user id 才可接管 legacy
-- slug 行；留存明確連結回執，禁止日後以同名 slug 覆寫資料歸屬。
CREATE TABLE IF NOT EXISTS student_identity_links (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id          INTEGER NOT NULL REFERENCES students(id),
  uc_user_id          INTEGER NOT NULL,
  verified_slug       TEXT    NOT NULL,
  verification_source TEXT   NOT NULL,
  linked_at           TEXT    NOT NULL,
  UNIQUE (student_id, uc_user_id)
);

CREATE INDEX IF NOT EXISTS idx_student_identity_links_user
  ON student_identity_links(uc_user_id, linked_at);

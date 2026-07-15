-- 0001 學生閱讀星圖：三詞初讀評議的持久層
-- 標識鏈：User Center slug（bdfz_uc_session 服務端核驗）→ students.id → 各表 student_id。
-- 冪等契約：submissions 以 (student_id, lesson_id, content_hash) 唯一；重複提交/刷新不產生新記錄。
-- 星點穩定契約：star_nodes.seq 每學生單調遞增、只增不改；前端佈局只由 seq 推導，舊星永不移位。

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uc_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  lesson_id TEXT NOT NULL,
  block_id TEXT NOT NULL DEFAULT '',
  block_title TEXT NOT NULL DEFAULT '',
  lesson_title TEXT NOT NULL DEFAULT '',
  words_raw TEXT NOT NULL,      -- JSON：學生原始三詞（保序）
  words_norm TEXT NOT NULL,     -- JSON：規範化三詞（保序）
  content_hash TEXT NOT NULL,   -- sha256(lesson_id + '\n' + words_norm.join('\n'))
  ai_score INTEGER,
  ai_verdict TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,     -- 該生該課第幾版
  is_active INTEGER NOT NULL DEFAULT 1,   -- 每生每課僅一版 active
  source TEXT NOT NULL DEFAULT 'live',    -- live | synthetic | backfill
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_unique ON submissions(student_id, lesson_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_sub_student_active ON submissions(student_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sub_lesson_active ON submissions(lesson_id, is_active);

CREATE TABLE IF NOT EXISTS submission_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  student_id INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  position INTEGER NOT NULL,    -- 1..3
  word_raw TEXT NOT NULL,
  word_norm TEXT NOT NULL,
  group_key TEXT NOT NULL DEFAULT ''  -- 語義組（word_groups.group_key），無組時空串
);
CREATE INDEX IF NOT EXISTS idx_words_student ON submission_words(student_id, word_norm);
CREATE INDEX IF NOT EXISTS idx_words_lesson ON submission_words(lesson_id, word_norm);

-- 人工精編的近義聚類種子；members 為 JSON 陣列（word_norm）。
CREATE TABLE IF NOT EXISTS word_groups (
  group_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  members TEXT NOT NULL
);

-- 增量詞頻聚合：student|lesson|class|block|site 五個尺度
CREATE TABLE IF NOT EXISTS agg_word_freq (
  scope TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  word_norm TEXT NOT NULL,
  freq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, scope_key, word_norm)
);

-- 星點註冊表：節點出生即領取 seq，永不回收、永不重排
CREATE TABLE IF NOT EXISTS star_nodes (
  student_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,   -- 'lesson:<lessonId>' | 'word:<word_norm>'
  kind TEXT NOT NULL,      -- lesson | word
  ref TEXT NOT NULL,       -- lesson_id 或 word_norm
  seq INTEGER NOT NULL,
  born_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_nodes_student_seq ON star_nodes(student_id, seq);

-- 字詞題作答與掌握
CREATE TABLE IF NOT EXISTS vocab_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  correct INTEGER NOT NULL DEFAULT 0,
  answer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_va_lookup ON vocab_attempts(student_id, lesson_id, item_id);

CREATE TABLE IF NOT EXISTS vocab_mastery (
  student_id INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'learning',  -- learning | mastered
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, lesson_id, item_id)
);

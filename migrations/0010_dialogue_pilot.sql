-- Additive only. Requires verified backup + record-level restore/reconciliation.
-- Rollback disables the feature; NEVER drops these tables or restores stale data.
CREATE TABLE dialogue_sessions (
 id TEXT PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), lesson_id TEXT NOT NULL,
 curriculum_version TEXT NOT NULL, curriculum_json TEXT NOT NULL, policy_version TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 inflight TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(student_id, lesson_id, curriculum_version)
);
CREATE TABLE dialogue_turns (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES dialogue_sessions(id),
 mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher')),
 content TEXT NOT NULL, question_id TEXT, reply_to TEXT, status TEXT NOT NULL,
 model TEXT, model_version TEXT, policy_version TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(session_id, mutation_id, role)
);
CREATE INDEX dialogue_turn_history ON dialogue_turns(session_id, sequence);
CREATE TABLE dialogue_assessments (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES dialogue_sessions(id), turn_id TEXT NOT NULL REFERENCES dialogue_turns(id),
 objective_id TEXT NOT NULL, outcome TEXT NOT NULL, evidence_json TEXT NOT NULL, rationale TEXT NOT NULL,
 rule_version TEXT NOT NULL, curriculum_version TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(turn_id, objective_id)
);
CREATE TABLE dialogue_questions (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES dialogue_sessions(id), objective_id TEXT NOT NULL,
 attempt INTEGER NOT NULL, instance_json TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(session_id, objective_id, attempt)
);
CREATE UNIQUE INDEX dialogue_one_issued_question ON dialogue_questions(session_id) WHERE state='issued';
CREATE TABLE dialogue_calls (
 turn_id TEXT PRIMARY KEY REFERENCES dialogue_turns(id), session_id TEXT NOT NULL REFERENCES dialogue_sessions(id),
 student_id INTEGER NOT NULL, day TEXT NOT NULL, reserved_tokens INTEGER NOT NULL,
 state TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX dialogue_call_day ON dialogue_calls(day, student_id);
CREATE TABLE dialogue_events (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES dialogue_sessions(id), turn_id TEXT,
 event_type TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX dialogue_event_session ON dialogue_events(session_id, created_at);
-- One recoverable budget-deferred draft per revision; never counted as an answer.
CREATE TABLE dialogue_drafts (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES dialogue_sessions(id),
 mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, revision INTEGER NOT NULL,
 content TEXT NOT NULL, question_id TEXT, submitted_turn_id TEXT REFERENCES dialogue_turns(id),
 created_at TEXT NOT NULL, UNIQUE(session_id, mutation_id), UNIQUE(session_id, revision)
);

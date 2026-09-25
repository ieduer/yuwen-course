-- Additive, private source records. Never delete these tables on rollback.
-- Use trigger WHEN instead of unparenthesized CASE/END: remote D1 query
-- splitting differs from local SQLite (cloudflare/workers-sdk#4727).
CREATE TABLE learning_evaluation_jobs (
 source_event_id TEXT PRIMARY KEY REFERENCES learning_pending_submissions(source_event_id),
 student_id INTEGER NOT NULL,
 resource_key TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','leased','completed','blocked','uncertain')),
 first_pending_at INTEGER NOT NULL,
 next_attempt_at INTEGER NOT NULL,
 lease_epoch INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 last_error_class TEXT NOT NULL DEFAULT '',
 completed_at INTEGER
);
CREATE INDEX learning_jobs_due ON learning_evaluation_jobs(state,next_attempt_at,first_pending_at);
CREATE TABLE learning_evaluation_replies (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 source_event_id TEXT NOT NULL REFERENCES learning_evaluation_jobs(source_event_id),
 lease_epoch INTEGER NOT NULL,
 request_id TEXT NOT NULL,
 answer_text TEXT NOT NULL,
 raw_response_json TEXT,
 actual_model TEXT,
 model_version TEXT,
 version_status TEXT NOT NULL,
 received_at INTEGER NOT NULL,
 UNIQUE(source_event_id,lease_epoch)
);
CREATE TABLE learning_evaluation_commits (
 source_event_id TEXT PRIMARY KEY,
 lease_epoch INTEGER NOT NULL,
 committed_at INTEGER NOT NULL
);
CREATE TRIGGER learning_evaluation_commit_fence BEFORE INSERT ON learning_evaluation_commits
WHEN NOT EXISTS (
  SELECT 1 FROM learning_evaluation_jobs j WHERE j.source_event_id=NEW.source_event_id
   AND j.state='leased' AND j.lease_epoch=NEW.lease_epoch AND j.lease_until>=NEW.committed_at
 )
BEGIN
 SELECT RAISE(ABORT,'evaluation lease expired');
END;
CREATE TABLE learning_evaluation_scheduler (
 id INTEGER PRIMARY KEY CHECK(id=1), lease_until INTEGER NOT NULL DEFAULT 0,
 owner TEXT NOT NULL DEFAULT '', last_scan_at INTEGER, last_student_id INTEGER
);
INSERT INTO learning_evaluation_scheduler(id) VALUES(1);
-- Original accepted learner fields, before normalization for rubric/evidence.
CREATE TABLE learning_submission_records (
 source_event_id TEXT PRIMARY KEY REFERENCES learning_pending_submissions(source_event_id),
 student_id INTEGER NOT NULL,
 submitted_payload_json TEXT NOT NULL,
 captured_at TEXT NOT NULL
);
CREATE INDEX learning_jobs_owner_order ON learning_evaluation_jobs(student_id,resource_key,first_pending_at);

-- Delivery checkpoint only; Pulse remains the notification/dedupe authority.
CREATE TABLE IF NOT EXISTS learning_evaluation_alert_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_state TEXT NOT NULL DEFAULT '',
  last_reported_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO learning_evaluation_alert_state(id) VALUES(1);

-- Machine authentication replay fence and per-epoch outbound start fence.
CREATE TABLE learning_evaluation_machine_nonces (nonce TEXT PRIMARY KEY,used_at INTEGER NOT NULL);
CREATE TABLE learning_evaluation_executions (
 source_event_id TEXT NOT NULL REFERENCES learning_evaluation_jobs(source_event_id),
 lease_epoch INTEGER NOT NULL,
 started_at INTEGER NOT NULL,
 PRIMARY KEY(source_event_id,lease_epoch)
);

-- Full immutable source facts; the unified recorder bridge supplies UC scope.
CREATE TABLE learning_evaluation_events (
 event_id TEXT PRIMARY KEY,
 source_event_id TEXT NOT NULL REFERENCES learning_pending_submissions(source_event_id),
 student_id INTEGER NOT NULL,
 action TEXT NOT NULL,
 parent_event_id TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL,
 payload_bytes INTEGER NOT NULL
);
CREATE INDEX learning_evaluation_events_source ON learning_evaluation_events(source_event_id,action);
CREATE TRIGGER learning_event_conflict BEFORE INSERT ON learning_evaluation_events
WHEN EXISTS (SELECT 1 FROM learning_evaluation_events e WHERE e.event_id=NEW.event_id
  AND (e.payload_sha256!=NEW.payload_sha256 OR e.payload_json!=NEW.payload_json
   OR e.student_id!=NEW.student_id OR e.source_event_id!=NEW.source_event_id))
BEGIN
 SELECT RAISE(ABORT,'immutable learning event conflict');
END;
CREATE TRIGGER learning_event_no_update BEFORE UPDATE ON learning_evaluation_events
BEGIN
 SELECT RAISE(ABORT,'immutable learning event');
END;
CREATE TRIGGER learning_event_no_delete BEFORE DELETE ON learning_evaluation_events
BEGIN
 SELECT RAISE(ABORT,'immutable learning event');
END;

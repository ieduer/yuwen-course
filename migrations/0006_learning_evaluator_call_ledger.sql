-- 0006 YW evaluator-call budget ledger
--
-- The learner submission lease and evaluator-call budget are separate controls.
-- Every APIS feedback attempt is appended before outbound I/O and is never
-- deleted or refunded, including timeouts, upstream errors, malformed replies,
-- and gateway rejection. No student answer or prompt is stored here.

CREATE TABLE IF NOT EXISTS learning_evaluator_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL REFERENCES students(id),
  source_event_id TEXT    NOT NULL,
  resource_key    TEXT    NOT NULL,
  window_start    TEXT    NOT NULL,
  created_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_evaluator_calls_student_window
  ON learning_evaluator_calls(student_id, window_start, id);

CREATE INDEX IF NOT EXISTS idx_learning_evaluator_calls_mutation_window
  ON learning_evaluator_calls(student_id, source_event_id, window_start, id);

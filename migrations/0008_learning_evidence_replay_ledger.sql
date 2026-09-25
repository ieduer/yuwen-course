-- Bounded learning-evidence replay ledger (P11, owner decision 2026-09-24).
-- Additive only: no existing table, row or index changes.
--
-- A central quarantine receipt is terminal for its source attempt, so a
-- replay issues a new source-owned attempt (User Center requires
-- sourceAttemptId === sourceEventId for YW event-v2). The outbox row keeps its
-- original source_event_id and learning_interactions provenance. Before the
-- outbox row receives the new envelope, this ledger archives the exact prior
-- envelope bytes and delivery state. The primary key allows at most one replay
-- per outbox row, which makes the replay idempotent.
CREATE TABLE IF NOT EXISTS evidence_replay_ledger (
  source_event_id          TEXT    PRIMARY KEY REFERENCES evidence_outbox(source_event_id),
  replay_batch_id          TEXT    NOT NULL,
  replay_generation        INTEGER NOT NULL CHECK (replay_generation >= 1),
  reason_code              TEXT    NOT NULL,
  prior_source_attempt_id  TEXT    NOT NULL,
  prior_envelope_sha256    TEXT    NOT NULL,
  prior_envelope_json      TEXT    NOT NULL,
  prior_outbox_state_json  TEXT    NOT NULL,
  prior_academic_year      TEXT    NOT NULL,
  new_source_attempt_id    TEXT    NOT NULL UNIQUE,
  new_envelope_sha256      TEXT    NOT NULL,
  new_academic_year        TEXT    NOT NULL,
  replayed_at              TEXT    NOT NULL,
  CHECK (new_source_attempt_id <> prior_source_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_replay_ledger_batch
  ON evidence_replay_ledger(replay_batch_id, replayed_at);

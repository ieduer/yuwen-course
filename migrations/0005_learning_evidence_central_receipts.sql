-- Separate Queue transport state from the authoritative User Center receipt.
-- Historical v1 outbox rows remain immutable and are never sent to the v2 Queue.

ALTER TABLE evidence_outbox ADD COLUMN central_disposition TEXT
  CHECK (central_disposition IS NULL OR central_disposition IN (
    'accepted', 'pending_mapping', 'quarantined'
  ));

ALTER TABLE evidence_outbox ADD COLUMN central_receipted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_evidence_outbox_v2_recovery
  ON evidence_outbox(central_disposition, delivery_status, last_attempt_at, id);

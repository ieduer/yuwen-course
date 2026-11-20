-- 0014 receipt reconciliation reads only the rows still waiting for a central receipt
--
-- The minute reconciliation pass (OUTBOX_RECONCILE_SELECTION_SQL) was served by
-- idx_evidence_outbox_pending_id (delivery_status = ?). delivery_status stays
-- 'enqueued' after central acceptance, so every idle pass read the whole table
-- and the cost grew with every accepted row. Measured 2026-11-19 on production:
-- 6,158 rows, about 6,150 rows read per pass, 10,201 passes in seven days,
-- 62.7 million rows (96 % of this database's reads), no current-contract row due.
--
-- This partial index holds only rows without a final central decision, keyed by
-- the envelope schema and contract the statement already filters on. The
-- reconciliation statement itself is unchanged: its WHERE clause contains the
-- index predicate and three leading equality terms, so SQLite selects this index
-- for it (checked on workerd D1 and on SQLite 3.53). Ordering, the LIMIT, the
-- fifteen-minute receipt lease and every CAS stay as they are. The retry
-- selection (OUTBOX_RETRY_SELECTION_SQL) is also served by it, with the same rows.
--
-- Additive and idempotent. No row is rewritten. Accepted and quarantined rows
-- stay outside the index. Historical v1 rows sit under their own schema key and
-- are never read by the current-contract statements. No schema or contract
-- literal is stored here, so a later contract version uses the same index.
-- Rollback is DROP INDEX IF EXISTS idx_evidence_outbox_reconcile_due

CREATE INDEX IF NOT EXISTS idx_evidence_outbox_reconcile_due
  ON evidence_outbox(
    json_extract(envelope_json, '$.schema'),
    json_extract(envelope_json, '$.contractVersion'),
    delivery_status,
    COALESCE(central_receipted_at, created_at),
    id
  )
  WHERE (central_disposition IS NULL OR central_disposition = 'pending_mapping');

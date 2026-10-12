-- Policy snapshots are immutable per call. Unknown/abandoned calls retain cost.
ALTER TABLE dialogue_calls ADD COLUMN reserved_micros INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dialogue_calls ADD COLUMN accounted_micros INTEGER;
ALTER TABLE dialogue_calls ADD COLUMN budget_policy_json TEXT;

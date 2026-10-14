-- Additive. Unconfirmed visible text is retained but never grants mastery.
CREATE TABLE dialogue_stream_chunks (
 turn_id TEXT NOT NULL REFERENCES dialogue_turns(id), sequence INTEGER NOT NULL,
 content TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(turn_id,sequence)
);
ALTER TABLE dialogue_calls ADD COLUMN usage_json TEXT;
ALTER TABLE dialogue_calls ADD COLUMN first_token_ms INTEGER;
ALTER TABLE dialogue_calls ADD COLUMN completed_ms INTEGER;

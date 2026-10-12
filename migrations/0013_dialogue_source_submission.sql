-- Additive preservation of the exact original-source answer, including a draft
-- blocked before any paid call. No historical row or scoring rule is changed.
ALTER TABLE dialogue_turns ADD COLUMN source_request_json TEXT;
ALTER TABLE dialogue_drafts ADD COLUMN source_request_json TEXT;

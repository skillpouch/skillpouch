-- phase: expand
-- Tokens the account's AI assistants used, per day, model and assistant, as
-- each computer counted them from its own logs. `source_id` names the logs
-- (one per computer and OS user), not the device: logging in again re-sends
-- the same logs under the same source, so totals never count them twice.
CREATE TABLE token_usage (
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	source_id           text NOT NULL,
	day                 date NOT NULL,
	assistant           text NOT NULL,
	model               text NOT NULL,
	input_tokens        bigint NOT NULL CHECK (input_tokens >= 0),
	output_tokens       bigint NOT NULL CHECK (output_tokens >= 0),
	cache_read_tokens   bigint NOT NULL CHECK (cache_read_tokens >= 0),
	cache_write_tokens  bigint NOT NULL CHECK (cache_write_tokens >= 0),
	device_id           uuid,
	updated_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (storage_account_id, source_id, day, assistant, model)
);
CREATE INDEX token_usage_day_idx ON token_usage (storage_account_id, day);

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON token_usage
	USING (storage_account_id = current_setting('app.sa_id')::uuid)
	WITH CHECK (storage_account_id = current_setting('app.sa_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON token_usage TO sp_app, sp_worker, sp_maintenance;

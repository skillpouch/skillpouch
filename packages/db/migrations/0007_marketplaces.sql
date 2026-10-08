-- phase: expand
-- Marketplaces an account added (GitHub repositories) and the GitHub App
-- installations it connected for private ones. Tenant tables: RLS like the rest.
CREATE TABLE marketplaces (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	repo                text NOT NULL,
	installation_id     bigint,
	created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX marketplaces_repo_idx ON marketplaces (storage_account_id, lower(repo));

CREATE TABLE github_installations (
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	installation_id     bigint NOT NULL,
	account_login       text NOT NULL,
	account_type        text NOT NULL CHECK (account_type IN ('User', 'Organization')),
	github_user_id      bigint NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (storage_account_id, installation_id)
);

DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['marketplaces', 'github_installations'] LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
		EXECUTE format(
			'CREATE POLICY tenant_isolation ON %I
				USING (storage_account_id = current_setting(''app.sa_id'')::uuid)
				WITH CHECK (storage_account_id = current_setting(''app.sa_id'')::uuid)',
			t);
	END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplaces, github_installations TO sp_app, sp_worker, sp_maintenance;

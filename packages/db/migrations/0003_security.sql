-- phase: expand
-- Row-level security and grants (plan 08 §4.2).
--
-- Every table with a storage_account_id column gets RLS ENABLE + FORCE and the
-- tenant_isolation policy. current_setting() is called *without* missing_ok,
-- so a query without tenant context fails instead of returning rows.
DO $$
DECLARE
	t record;
BEGIN
	FOR t IN
		SELECT c.table_name
		FROM information_schema.columns c
		JOIN information_schema.tables tb
			ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
		WHERE c.table_schema = 'public'
			AND c.column_name = 'storage_account_id'
			AND tb.table_type = 'BASE TABLE'
			AND c.table_name <> 'cli_auth_requests'   -- pre-tenant (03 §5.0 rule 1)
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
		EXECUTE format(
			'CREATE POLICY tenant_isolation ON %I
				USING (storage_account_id = current_setting(''app.sa_id'')::uuid)
				WITH CHECK (storage_account_id = current_setting(''app.sa_id'')::uuid)',
			t.table_name);
	END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO sp_app, sp_worker, sp_maintenance, sp_admin;

-- API and tenant-scoped worker jobs.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sp_app, sp_worker;
-- Append-only tables: no UPDATE/DELETE for the app (08 §10, 15 §7.1).
REVOKE UPDATE, DELETE ON audit_log, roster_statements FROM sp_app, sp_worker;

-- Cross-tenant maintenance jobs (GC, retention, usage).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sp_maintenance;

-- Admin dashboard: metadata only — no access to ciphertext tables (18 §2).
GRANT SELECT ON users, storage_accounts, devices, pouches, plans, plan_grants,
	entitlement_overrides, subscriptions, audit_log, security_events, system_settings,
	account_members, sessions, billing_events TO sp_admin;
GRANT UPDATE ON users, storage_accounts, devices, plans, system_settings, sessions, subscriptions TO sp_admin;
GRANT INSERT ON plans, plan_grants, audit_log, system_settings, security_events TO sp_admin;
GRANT INSERT, UPDATE, DELETE ON entitlement_overrides TO sp_admin;
GRANT UPDATE ON plan_grants TO sp_admin;
GRANT DELETE ON sessions TO sp_admin;

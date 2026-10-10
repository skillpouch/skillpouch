-- phase: expand
-- Payments belong to an account like every tenant table: row-level security
-- with the tenant policy. Only BYPASSRLS roles (the sync job, the admin
-- dashboard) read or write them today.
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments
	USING (storage_account_id = current_setting('app.sa_id')::uuid)
	WITH CHECK (storage_account_id = current_setting('app.sa_id')::uuid);

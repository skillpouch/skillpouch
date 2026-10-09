-- phase: expand
-- Charges as the billing provider reports them (Polar orders), for the admin
-- dashboard's earnings. Copied from the provider by a sync job; the provider
-- stays the record. Cross-tenant and admin-only: no app or worker access.
CREATE TABLE payments (
	id                  text PRIMARY KEY,
	provider            text NOT NULL,
	storage_account_id  uuid REFERENCES storage_accounts (id),
	plan_id             uuid REFERENCES plans (id),
	status              text NOT NULL,
	currency            text NOT NULL,
	amount_cents        integer NOT NULL,
	net_cents           integer NOT NULL,
	tax_cents           integer NOT NULL DEFAULT 0,
	refunded_cents      integer NOT NULL DEFAULT 0,
	created_at          timestamptz NOT NULL,
	updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_created_idx ON payments (created_at DESC);
CREATE INDEX payments_account_idx ON payments (storage_account_id);

REVOKE ALL ON payments FROM sp_app, sp_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO sp_maintenance;
GRANT SELECT ON payments TO sp_admin;

-- Totals for the admin dashboard; admins never see which models or days one
-- account used beyond these sums (the API only returns aggregates).
GRANT SELECT ON token_usage TO sp_admin;

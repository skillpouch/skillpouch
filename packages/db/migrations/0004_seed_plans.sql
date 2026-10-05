-- phase: expand
-- Seed plans (18 §3.1). Editable afterwards in the admin dashboard.
INSERT INTO plans (slug, name, description, price_cents, currency, interval, pouch_limit, storage_bytes, is_default, sort)
VALUES
	('free', 'Free', 'Everything, for everyone.', 0, 'usd', NULL, 1, 104857600, true, 0),
	('supporter', 'Supporter', 'Support the project: more pouches and storage.', 500, 'usd', 'month', 3, 1073741824, false, 10)
ON CONFLICT (slug) DO NOTHING;

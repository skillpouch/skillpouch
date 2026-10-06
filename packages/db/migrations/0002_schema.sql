-- phase: expand
-- Initial schema (plan 03 §5, 08 §4, 15, 18). Tenant tables carry
-- storage_account_id, composite foreign keys and row-level security.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- identity (Better Auth)
CREATE TABLE users (
	id              text PRIMARY KEY,
	name            text NOT NULL,
	email           text NOT NULL UNIQUE,
	email_verified  boolean NOT NULL DEFAULT false,
	image           text,
	role            text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
	suspended_at    timestamptz,
	deleted_at      timestamptz,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
	id          text PRIMARY KEY,
	token       text NOT NULL UNIQUE,
	user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at  timestamptz NOT NULL,
	ip_address  text,
	user_agent  text,
	jkt         text,              -- browser key binding (08 §5.2)
	step_up_at  timestamptz,       -- last fresh OAuth sign-in (08 §5.3)
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_jkt_idx ON sessions (jkt) WHERE jkt IS NOT NULL;

CREATE TABLE accounts (
	id                        text PRIMARY KEY,
	account_id                text NOT NULL,
	provider_id               text NOT NULL,
	user_id                   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	access_token              text,
	refresh_token             text,
	id_token                  text,
	access_token_expires_at   timestamptz,
	refresh_token_expires_at  timestamptz,
	scope                     text,
	password                  text,
	created_at                timestamptz NOT NULL DEFAULT now(),
	updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

CREATE TABLE verifications (
	id          text PRIMARY KEY,
	identifier  text NOT NULL,
	value       text NOT NULL,
	expires_at  timestamptz NOT NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);

-- ---------------------------------------------------------------- plans (18 §3)
CREATE TABLE plans (
	id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	slug              text NOT NULL UNIQUE,
	name              text NOT NULL,
	description       text NOT NULL DEFAULT '',
	price_cents       integer NOT NULL DEFAULT 0,
	currency          text NOT NULL DEFAULT 'usd',
	interval          text CHECK (interval IN ('month', 'year')),
	pouch_limit       integer NOT NULL,
	storage_bytes     bigint NOT NULL,
	polar_product_id  text UNIQUE,
	is_default        boolean NOT NULL DEFAULT false,
	is_public         boolean NOT NULL DEFAULT true,
	is_active         boolean NOT NULL DEFAULT true,
	sort              integer NOT NULL DEFAULT 0,
	created_at        timestamptz NOT NULL DEFAULT now(),
	updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plans_one_default ON plans (is_default) WHERE is_default;

-- ---------------------------------------------------------------- storage accounts (03 §5.2)
-- Not a tenant table itself: it *is* the tenant. Accessed by id from the principal.
CREATE TABLE storage_accounts (
	id                 uuid PRIMARY KEY,
	owner_user_id      text NOT NULL UNIQUE REFERENCES users (id),
	entitlements       jsonb NOT NULL,
	quota_bytes        bigint NOT NULL,
	used_bytes         bigint NOT NULL DEFAULT 0,
	pending_bytes      bigint NOT NULL DEFAULT 0,
	over_quota_since   timestamptz,
	security_settings  jsonb NOT NULL DEFAULT '{}',
	genesis_hash       bytea,
	roster_seq         bigint NOT NULL DEFAULT 0,
	roster_head_hash   bytea,
	delete_after       timestamptz,
	reset_after        timestamptz,
	created_at         timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- pouches (03 §5.3)
CREATE TABLE pouches (
	id                     uuid PRIMARY KEY,
	storage_account_id     uuid NOT NULL REFERENCES storage_accounts (id),
	created_seq            bigint NOT NULL,
	state                  text NOT NULL DEFAULT 'active'
	                       CHECK (state IN ('active', 'locked', 'archived', 'deleted')),
	epoch                  uuid NOT NULL,
	event_seq              bigint NOT NULL DEFAULT 0,
	events_purged_through  bigint NOT NULL DEFAULT 0,
	key_gen                integer NOT NULL DEFAULT 1,
	delete_after           timestamptz,
	created_at             timestamptz NOT NULL DEFAULT now(),
	updated_at             timestamptz NOT NULL DEFAULT now(),
	UNIQUE (storage_account_id, id)
);

-- ---------------------------------------------------------------- devices (03 §5.4)
CREATE TABLE devices (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	user_id             text NOT NULL REFERENCES users (id),
	name                text NOT NULL,
	os                  text NOT NULL CHECK (os IN ('linux', 'macos', 'windows')),
	arch                text NOT NULL,
	cli_version         text NOT NULL,
	active_pouch_id     uuid,
	state               text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended', 'revoked')),
	authorized_from     uuid,
	token_version       integer NOT NULL DEFAULT 1,
	refresh_hash        bytea NOT NULL,
	refresh_family_id   uuid NOT NULL,
	prev_refresh_hash   bytea,
	registered_ip_hash  bytea,
	last_seen_at        timestamptz,
	last_ip_hash        bytea,
	revoked_at          timestamptz,
	revoke_reason       text,
	created_at          timestamptz NOT NULL DEFAULT now(),
	UNIQUE (storage_account_id, id)
);
CREATE INDEX devices_active_idx ON devices (storage_account_id) WHERE state = 'active';

CREATE TABLE device_keys (
	storage_account_id  uuid NOT NULL,
	device_id           uuid NOT NULL,
	jkt                 text NOT NULL,
	public_jwk          jsonb NOT NULL,
	key_storage         text NOT NULL CHECK (key_storage IN ('tpm', 'secure_enclave', 'os_keystore', 'file')),
	created_at          timestamptz NOT NULL DEFAULT now(),
	retired_at          timestamptz,
	PRIMARY KEY (storage_account_id, device_id, jkt),
	FOREIGN KEY (storage_account_id, device_id) REFERENCES devices (storage_account_id, id)
);
CREATE UNIQUE INDEX device_keys_jkt_idx ON device_keys (jkt);

-- Pre-tenant: DPoP replay cache (08 §3.2). No content, no RLS.
CREATE UNLOGGED TABLE dpop_replay (
	jti         text PRIMARY KEY,
	expires_at  timestamptz NOT NULL
);

-- Pre-tenant: "Authorize CLI" requests (08 §6). Reachable only by unguessable id.
CREATE TABLE cli_auth_requests (
	id                  uuid PRIMARY KEY,
	code_challenge      bytea NOT NULL,
	jkt                 text NOT NULL,
	sign_pub            jsonb NOT NULL,
	enc_pub             jsonb NOT NULL,
	key_storage         text NOT NULL,
	device_name         text NOT NULL,
	os                  text NOT NULL,
	arch                text NOT NULL,
	cli_version         text NOT NULL,
	ip_hash             bytea NOT NULL,
	geo                 text,
	state               text NOT NULL DEFAULT 'open'
	                    CHECK (state IN ('open', 'approved', 'denied', 'expired', 'redeemed')),
	storage_account_id  uuid,
	approved_by_member  uuid,
	device_id           uuid,
	welcome             bytea,
	expires_at          timestamptz NOT NULL,
	finalized_at        timestamptz,
	created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cli_auth_requests_expires_idx ON cli_auth_requests (expires_at);
CREATE INDEX cli_auth_requests_ip_idx ON cli_auth_requests (ip_hash) WHERE state = 'open';

-- ---------------------------------------------------------------- E2EE membership (03 §5.12a, 15)
CREATE TABLE account_members (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	kind                text NOT NULL CHECK (kind IN ('password', 'browser', 'device', 'recovery', 'passkey')),
	member_salt         bytea,           -- secret-derived kinds: HKDF salt (15 §4)
	device_id           uuid,
	session_jkt         text,
	sign_pub            jsonb NOT NULL,
	enc_pub             jsonb NOT NULL,
	label_enc           bytea,
	key_storage         text,
	added_seq           bigint NOT NULL,
	removed_seq         bigint,
	revoked_at          timestamptz,     -- server-side revoke (rotation may still be pending)
	last_seen_at        timestamptz,
	trust_expired_at    timestamptz,     -- browser unused longer than the trust window (15 §8.2)
	created_at          timestamptz NOT NULL DEFAULT now(),
	UNIQUE (storage_account_id, id),
	FOREIGN KEY (storage_account_id, device_id) REFERENCES devices (storage_account_id, id)
);
CREATE INDEX account_members_session_jkt_idx ON account_members (session_jkt) WHERE session_jkt IS NOT NULL;
CREATE UNIQUE INDEX account_members_device_idx ON account_members (device_id) WHERE device_id IS NOT NULL;

CREATE TABLE roster_statements (
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	seq                 bigint NOT NULL,
	pouch_id            uuid,
	prev_hash           bytea,
	statement           bytea NOT NULL,
	statement_hash      bytea NOT NULL,
	signer_member_id    uuid NOT NULL,
	signature           bytea NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (storage_account_id, seq)
);

CREATE TABLE key_envelopes (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	member_id           uuid NOT NULL,
	key_gen             integer NOT NULL,
	hpke_enc            bytea NOT NULL,
	ciphertext          bytea NOT NULL,
	created_by_member   uuid NOT NULL,
	signature           bytea NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (pouch_id, member_id, key_gen),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id),
	FOREIGN KEY (storage_account_id, member_id) REFERENCES account_members (storage_account_id, id),
	FOREIGN KEY (storage_account_id, created_by_member) REFERENCES account_members (storage_account_id, id)
);
CREATE INDEX key_envelopes_member_idx ON key_envelopes (storage_account_id, member_id);

-- Master-password unlock parameters (15 §4.1, §8.6). The pepper is sealed with
-- PEPPER_KEY, an off-database secret: a DB/backup thief cannot start guessing.
-- `pending_*` holds freshly prepared parameters until genesis / a password change commits them.
CREATE TABLE account_unlock (
	storage_account_id         uuid PRIMARY KEY REFERENCES storage_accounts (id),
	kdf_salt                   bytea,
	kdf_params                 jsonb,
	pepper_ciphertext          bytea,
	pepper_key_id              text,
	pending_kdf_salt           bytea,
	pending_kdf_params         jsonb,
	pending_pepper_ciphertext  bytea,
	pending_pepper_key_id      text,
	pending_created_at         timestamptz,
	failed_streak              integer NOT NULL DEFAULT 0,
	updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn credentials used ONLY for PRF unlock, never for sign-in (15 §8.5).
CREATE TABLE passkey_unlockers (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	member_id           uuid NOT NULL,
	credential_id       bytea NOT NULL,
	public_key          bytea NOT NULL,
	sign_count          bigint NOT NULL DEFAULT 0,
	transports          text[],
	label               text,
	created_at          timestamptz NOT NULL DEFAULT now(),
	last_used_at        timestamptz,
	UNIQUE (storage_account_id, id),
	UNIQUE (storage_account_id, credential_id),
	FOREIGN KEY (storage_account_id, member_id) REFERENCES account_members (storage_account_id, id)
);

-- Short-lived WebAuthn challenges (registration / PRF assertion), bound to one web session.
CREATE TABLE webauthn_challenges (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	session_id          text NOT NULL,
	purpose             text NOT NULL CHECK (purpose IN ('register', 'unlock')),
	challenge           text NOT NULL,
	expires_at          timestamptz NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges (expires_at);

-- "This web session proved it holds the secret of member X" (pepper released /
-- passkey asserted); required before the envelopes of secret-derived members
-- are released to a not-yet-enrolled browser (15 §8.1).
CREATE TABLE unlock_grants (
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	session_id          text NOT NULL,
	member_id           uuid NOT NULL,
	expires_at          timestamptz NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (session_id, member_id),
	FOREIGN KEY (storage_account_id, member_id) REFERENCES account_members (storage_account_id, id)
);
CREATE INDEX unlock_grants_expiry_idx ON unlock_grants (expires_at);

-- ---------------------------------------------------------------- sync (03 §5.5–5.12)
CREATE TABLE device_cursors (
	storage_account_id  uuid NOT NULL,
	device_id           uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	epoch               uuid NOT NULL,
	acked_seq           bigint NOT NULL,
	updated_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (device_id, pouch_id),
	FOREIGN KEY (storage_account_id, device_id) REFERENCES devices (storage_account_id, id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id)
);

CREATE TABLE blobs (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	blob_id             bytea NOT NULL,
	ciphertext_hash     bytea,
	stored_size         bigint NOT NULL,
	key_gen             integer,
	ref_count           integer NOT NULL DEFAULT 0,
	state               text NOT NULL CHECK (state IN ('pending', 'stored')),
	created_at          timestamptz NOT NULL DEFAULT now(),
	unreferenced_since  timestamptz,
	PRIMARY KEY (storage_account_id, pouch_id, blob_id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id)
);
CREATE INDEX blobs_gc_idx ON blobs (unreferenced_since) WHERE ref_count = 0 AND state = 'stored';
CREATE INDEX blobs_pending_idx ON blobs (created_at) WHERE state = 'pending';

CREATE TABLE artifacts (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	name_index          bytea NOT NULL,
	head_revision_id    uuid,
	deleted_at          timestamptz,
	created_at          timestamptz NOT NULL DEFAULT now(),
	updated_at          timestamptz NOT NULL DEFAULT now(),
	UNIQUE (storage_account_id, id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id)
);
CREATE UNIQUE INDEX artifacts_live_key ON artifacts (pouch_id, name_index) WHERE deleted_at IS NULL;
CREATE INDEX artifacts_pouch_idx ON artifacts (pouch_id, id);

-- parent_id / merge_parent_id are deliberately not foreign keys: retention
-- prunes old revisions while their descendants stay (03 §7).
CREATE TABLE revisions (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	artifact_id         uuid NOT NULL,
	parent_id           uuid,
	merge_parent_id     uuid,
	envelope            bytea NOT NULL,
	envelope_hash       bytea NOT NULL,
	signature           bytea NOT NULL,
	signer_member_id    uuid NOT NULL,
	key_gen             integer NOT NULL,
	stored_size         bigint NOT NULL,
	author_device_id    uuid,
	author_user_id      text NOT NULL REFERENCES users (id),
	origin              text NOT NULL CHECK (origin IN ('daemon', 'web', 'restore', 'resolve', 'import')),
	created_at          timestamptz NOT NULL DEFAULT now(),
	expires_at          timestamptz,
	UNIQUE (storage_account_id, id),
	FOREIGN KEY (storage_account_id, artifact_id) REFERENCES artifacts (storage_account_id, id),
	FOREIGN KEY (storage_account_id, signer_member_id) REFERENCES account_members (storage_account_id, id),
	FOREIGN KEY (storage_account_id, author_device_id) REFERENCES devices (storage_account_id, id)
);
CREATE INDEX revisions_artifact_idx ON revisions (artifact_id, created_at DESC);
CREATE INDEX revisions_expiry_idx ON revisions (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE artifacts
	ADD FOREIGN KEY (storage_account_id, head_revision_id) REFERENCES revisions (storage_account_id, id);

CREATE TABLE revision_blobs (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	revision_id         uuid NOT NULL,
	blob_id             bytea NOT NULL,
	PRIMARY KEY (revision_id, blob_id),
	FOREIGN KEY (storage_account_id, revision_id) REFERENCES revisions (storage_account_id, id) ON DELETE CASCADE,
	FOREIGN KEY (storage_account_id, pouch_id, blob_id) REFERENCES blobs (storage_account_id, pouch_id, blob_id)
);
CREATE INDEX revision_blobs_blob_idx ON revision_blobs (storage_account_id, pouch_id, blob_id);

CREATE TABLE bindings (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	artifact_id         uuid NOT NULL,
	device_id           uuid NOT NULL,
	payload             bytea NOT NULL,
	key_gen             integer NOT NULL,
	updated_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (artifact_id, device_id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id),
	FOREIGN KEY (storage_account_id, artifact_id) REFERENCES artifacts (storage_account_id, id),
	FOREIGN KEY (storage_account_id, device_id) REFERENCES devices (storage_account_id, id)
);
CREATE INDEX bindings_pouch_idx ON bindings (pouch_id);

CREATE TABLE events (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	seq                 bigint NOT NULL,
	epoch               uuid NOT NULL,
	type                text NOT NULL,
	artifact_id         uuid,
	revision_id         uuid,
	operation_id        uuid,
	device_id           uuid,
	payload             jsonb NOT NULL DEFAULT '{}',
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (pouch_id, seq),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id)
);
CREATE INDEX events_created_idx ON events (created_at);

CREATE TABLE operation_receipts (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	operation_id        uuid NOT NULL,
	request_digest      bytea NOT NULL,
	status              text NOT NULL CHECK (status IN ('applied', 'conflict', 'rejected', 'mixed')),
	response            jsonb NOT NULL,
	device_id           uuid,
	device_jkt          text,
	device_signature    text,
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (pouch_id, operation_id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id)
);
CREATE INDEX operation_receipts_created_idx ON operation_receipts (created_at);

CREATE TABLE conflicts (
	id                    uuid PRIMARY KEY,
	storage_account_id    uuid NOT NULL,
	pouch_id              uuid NOT NULL,
	artifact_id           uuid,
	type                  text NOT NULL
	                      CHECK (type IN ('update_update', 'edit_delete', 'delete_edit', 'name_collision', 'local_projection')),
	base_revision_id      uuid,
	server_revision_id    uuid,
	incoming_revision_id  uuid,
	device_id             uuid,
	state                 text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'superseded')),
	resolution            text,
	resolved_by           text REFERENCES users (id),
	created_at            timestamptz NOT NULL DEFAULT now(),
	resolved_at           timestamptz,
	UNIQUE (storage_account_id, id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id),
	FOREIGN KEY (storage_account_id, artifact_id) REFERENCES artifacts (storage_account_id, id),
	FOREIGN KEY (storage_account_id, incoming_revision_id) REFERENCES revisions (storage_account_id, id)
);
CREATE INDEX conflicts_open_idx ON conflicts (pouch_id) WHERE state = 'open';

CREATE TABLE checkpoints (
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	member_id           uuid NOT NULL,
	pouch_seq           bigint NOT NULL,
	roster_head         bytea NOT NULL,
	signature           bytea NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (pouch_id, member_id),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id),
	FOREIGN KEY (storage_account_id, member_id) REFERENCES account_members (storage_account_id, id)
);

CREATE TABLE snapshots (
	id                  uuid PRIMARY KEY,
	storage_account_id  uuid NOT NULL,
	pouch_id            uuid NOT NULL,
	epoch               uuid NOT NULL,
	seq                 bigint NOT NULL,
	expires_at          timestamptz NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	FOREIGN KEY (storage_account_id, pouch_id) REFERENCES pouches (storage_account_id, id)
);

-- ---------------------------------------------------------------- billing & entitlements (09, 18)
CREATE TABLE plan_grants (
	id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	plan_id             uuid NOT NULL REFERENCES plans (id),
	starts_at           timestamptz NOT NULL DEFAULT now(),
	ends_at             timestamptz,
	reason              text NOT NULL,
	granted_by          text NOT NULL REFERENCES users (id),
	revoked_at          timestamptz,
	created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlement_overrides (
	storage_account_id  uuid PRIMARY KEY REFERENCES storage_accounts (id),
	pouch_limit         integer,
	storage_bytes       bigint,
	expires_at          timestamptz,
	note                text NOT NULL DEFAULT '',
	updated_by          text NOT NULL REFERENCES users (id),
	updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
	id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	storage_account_id        uuid NOT NULL REFERENCES storage_accounts (id),
	plan_id                   uuid REFERENCES plans (id),
	provider                  text NOT NULL,
	external_customer_id      text NOT NULL,
	external_subscription_id  text NOT NULL UNIQUE,
	status                    text NOT NULL,
	interval                  text,
	amount_cents              integer NOT NULL DEFAULT 0,
	current_period_end        timestamptz,
	cancel_at_period_end      boolean NOT NULL DEFAULT false,
	-- Provider's own modification time: older webhook deliveries never overwrite newer state.
	provider_updated_at       timestamptz,
	updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_events (
	provider      text NOT NULL,
	external_id   text NOT NULL,
	type          text NOT NULL,
	payload       jsonb NOT NULL,
	processed_at  timestamptz,
	created_at    timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (provider, external_id)
);

-- ---------------------------------------------------------------- ops (03 §5.14)
CREATE UNLOGGED TABLE rate_limits (
	key          text PRIMARY KEY,
	tokens       double precision NOT NULL,
	refilled_at  timestamptz NOT NULL
);

CREATE TABLE audit_log (
	id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	storage_account_id  uuid REFERENCES storage_accounts (id),
	actor               text NOT NULL,
	action              text NOT NULL,
	target              text,
	details             jsonb NOT NULL DEFAULT '{}',
	ip_hash             bytea,
	prev_hash           bytea,
	row_hash            bytea NOT NULL,
	created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_account_idx ON audit_log (storage_account_id, created_at);

CREATE TABLE security_events (
	id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	storage_account_id  uuid NOT NULL REFERENCES storage_accounts (id),
	kind                text NOT NULL,
	severity            text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
	details             jsonb NOT NULL DEFAULT '{}',
	created_at          timestamptz NOT NULL DEFAULT now(),
	acknowledged_at     timestamptz
);
CREATE INDEX security_events_account_idx ON security_events (storage_account_id, created_at DESC);

CREATE TABLE system_settings (
	key         text PRIMARY KEY,
	value       jsonb NOT NULL,
	updated_at  timestamptz NOT NULL DEFAULT now()
);

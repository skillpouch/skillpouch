-- phase: expand
-- no-transaction
-- Indexes for the background jobs and the admin dashboard. Both run on roles
-- that bypass row-level security, so the tenant-leading indexes the API uses
-- do not help them. Built CONCURRENTLY: writes keep flowing during a deploy.

-- Sync cursors by pouch (pouch purge, Devices page per account).
CREATE INDEX CONCURRENTLY IF NOT EXISTS device_cursors_pouch_idx
	ON device_cursors (storage_account_id, pouch_id);

-- "Is this revision a head?" — retention and Free up space.
CREATE INDEX CONCURRENTLY IF NOT EXISTS artifacts_head_revision_idx
	ON artifacts (head_revision_id) WHERE head_revision_id IS NOT NULL;

-- Unlinking children when retention deletes their parent revision.
CREATE INDEX CONCURRENTLY IF NOT EXISTS revisions_parent_idx
	ON revisions (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS revisions_merge_parent_idx
	ON revisions (merge_parent_id) WHERE merge_parent_id IS NOT NULL;

-- Delayed purges (pouches, accounts, encryption resets).
CREATE INDEX CONCURRENTLY IF NOT EXISTS pouches_purge_idx
	ON pouches (delete_after) WHERE state = 'deleted';
CREATE INDEX CONCURRENTLY IF NOT EXISTS storage_accounts_delete_idx
	ON storage_accounts (delete_after) WHERE delete_after IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS storage_accounts_reset_idx
	ON storage_accounts (reset_after) WHERE reset_after IS NOT NULL;

-- Share expiry job: only links still holding ciphertext.
CREATE INDEX CONCURRENTLY IF NOT EXISTS shares_expiry_idx
	ON shares (expires_at) WHERE stored_size > 0;

-- Browser trust expiry job: only browsers that are still trusted.
CREATE INDEX CONCURRENTLY IF NOT EXISTS account_members_browser_trust_idx
	ON account_members ((COALESCE(last_seen_at, created_at)))
	WHERE kind = 'browser' AND removed_seq IS NULL AND revoked_at IS NULL AND trust_expired_at IS NULL;

-- Admin dashboard: newest audit entries, and counts per action over a window.
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_created_idx
	ON audit_log (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_action_idx
	ON audit_log (action, created_at);

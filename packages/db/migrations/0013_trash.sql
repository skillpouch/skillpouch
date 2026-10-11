-- phase: expand
-- no-transaction
-- Deleted items, oldest first: `trash.empty` removes their files once they
-- have been in the trash for 7 days. Built CONCURRENTLY: writes keep flowing
-- during a deploy.
CREATE INDEX CONCURRENTLY IF NOT EXISTS artifacts_deleted_idx
	ON artifacts (deleted_at) WHERE deleted_at IS NOT NULL;

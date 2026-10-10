-- phase: expand
-- A deleted item's head revision is its signed delete: what tells a computer
-- that comes back after months to remove its copy rather than send it back.
-- "Free up space" and retention free its files, never the record. The head
-- revision can't be deleted while an artifact points at it (foreign key);
-- these triggers keep the artifact and that pointer. Only purging a whole
-- pouch removes them, and it says so first with
-- `set_config('app.purging_pouch', <pouch id>, true)`.
CREATE FUNCTION keep_artifact_records() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('app.purging_pouch', true) IS DISTINCT FROM OLD.pouch_id::text THEN
		RAISE EXCEPTION 'items and their head revision are kept until their pouch is purged'
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END
$$;

CREATE TRIGGER artifacts_keep_records
	BEFORE DELETE ON artifacts
	FOR EACH ROW EXECUTE FUNCTION keep_artifact_records();

CREATE TRIGGER artifacts_keep_heads
	BEFORE UPDATE OF head_revision_id ON artifacts
	FOR EACH ROW
	WHEN (OLD.head_revision_id IS NOT NULL AND NEW.head_revision_id IS NULL)
	EXECUTE FUNCTION keep_artifact_records();

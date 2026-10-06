-- phase: expand
-- Database roles (plan 08 §4.2). Roles are cluster-wide, so this is idempotent.
-- Production login users are created by deploy/postgres/init and are members of these roles.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sp_app') THEN
		CREATE ROLE sp_app NOLOGIN;                    -- API: no BYPASSRLS, no DDL
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sp_worker') THEN
		CREATE ROLE sp_worker NOLOGIN;                 -- worker, tenant-scoped jobs
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sp_maintenance') THEN
		CREATE ROLE sp_maintenance NOLOGIN BYPASSRLS;  -- worker, cross-tenant jobs only
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sp_admin') THEN
		CREATE ROLE sp_admin NOLOGIN BYPASSRLS;        -- admin dashboard; metadata grants only
	END IF;
END
$$;

-- The migrating login (the database owner in production, a superuser in dev)
-- may SET ROLE into the runtime roles, so one login can serve every pool with
-- DB_SET_ROLE=true. It does not *inherit* their privileges (INHERIT FALSE):
-- RLS still applies to whatever role a pool switched to.
DO $$
BEGIN
	IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
		EXECUTE format('GRANT sp_app, sp_worker, sp_maintenance, sp_admin TO %I WITH INHERIT FALSE, SET TRUE', current_user);
	END IF;
END
$$;

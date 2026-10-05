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

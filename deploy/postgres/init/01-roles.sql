-- SPDX-License-Identifier: AGPL-3.0-only
-- First boot only: the application login that owns the database and runs
-- migrations. Runtime roles (sp_app, sp_worker, sp_maintenance, sp_admin) are
-- created by migration 0001; this login may SET ROLE into them (DB_SET_ROLE).
\set password `echo "$SKILLPOUCH_DB_PASSWORD"`
CREATE ROLE skillpouch LOGIN CREATEROLE PASSWORD :'password';
CREATE DATABASE skillpouch OWNER skillpouch;
\c skillpouch
ALTER SCHEMA public OWNER TO skillpouch;

-- Runtime roles. Migration 0001 creates them too (IF NOT EXISTS), but since
-- Postgres 16 only a superuser may create BYPASSRLS roles, so production
-- creates them here, once, as the superuser.
CREATE ROLE sp_app NOLOGIN;
CREATE ROLE sp_worker NOLOGIN;
CREATE ROLE sp_maintenance NOLOGIN BYPASSRLS;
CREATE ROLE sp_admin NOLOGIN BYPASSRLS;
-- The application login may SET ROLE into them but does not inherit them.
GRANT sp_app, sp_worker, sp_maintenance, sp_admin TO skillpouch
	WITH ADMIN OPTION, INHERIT FALSE, SET TRUE;

-- SPDX-License-Identifier: AGPL-3.0-only
-- First boot only: the application login that owns the database and runs
-- migrations. Runtime roles (sp_app, sp_worker, sp_maintenance, sp_admin) are
-- created by migration 0001; this login may SET ROLE into them (DB_SET_ROLE).
\set password `echo "$SKILLPOUCH_DB_PASSWORD"`
CREATE ROLE skillpouch LOGIN CREATEROLE PASSWORD :'password';
CREATE DATABASE skillpouch OWNER skillpouch;
\c skillpouch
ALTER SCHEMA public OWNER TO skillpouch;

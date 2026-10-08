-- phase: expand
-- A searchable copy of the official MCP Registry, whose own search takes
-- 10–30 s. Public data shared by every account, so no tenant column or RLS.
-- One row in mcp_registry_sync tracks progress and which process holds the
-- sync lease; a full read that gets interrupted resumes from crawl_cursor.
CREATE TABLE mcp_registry_servers (
	name         text PRIMARY KEY,
	short_name   text NOT NULL,
	server       jsonb NOT NULL,
	search_text  text NOT NULL,
	updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp_registry_sync (
	id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	synced_since   timestamptz,
	crawl_cursor   text,
	crawl_started  timestamptz,
	lease_owner    text,
	lease_until    timestamptz
);
INSERT INTO mcp_registry_sync (id) VALUES (1);

GRANT SELECT ON mcp_registry_servers, mcp_registry_sync TO sp_app, sp_maintenance;
GRANT INSERT, UPDATE, DELETE ON mcp_registry_servers TO sp_maintenance;
GRANT UPDATE ON mcp_registry_sync TO sp_maintenance;

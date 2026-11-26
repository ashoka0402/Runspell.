BEGIN;

CREATE TABLE runspell.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES runspell.workspaces (id),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('browser', 'api')),
  origin text NOT NULL CHECK (char_length(origin) <= 512 AND origin ~ '^https://[^/?#@[:space:]]+$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  revoked_at timestamptz,
  status text GENERATED ALWAYS AS (
    CASE WHEN revoked_at IS NULL THEN 'pending' ELSE 'revoked' END
  ) STORED
);

CREATE INDEX connections_workspace_id ON runspell.connections (workspace_id, id);
ALTER TABLE runspell.connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_connections ON runspell.connections
  FOR SELECT TO runspell_runtime USING (runspell.workspace_role(workspace_id) IS NOT NULL);

CREATE POLICY create_connection ON runspell.connections
  FOR INSERT TO runspell_runtime
  WITH CHECK (runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor') AND revoked_at IS NULL);

CREATE POLICY revoke_connection ON runspell.connections
  FOR UPDATE TO runspell_runtime
  USING (runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor') AND revoked_at IS NULL)
  WITH CHECK (runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor') AND revoked_at IS NOT NULL);

REVOKE ALL ON runspell.connections FROM PUBLIC, runspell_runtime;
GRANT SELECT (id, workspace_id, label, kind, origin, created_at, revoked_at, status)
  ON runspell.connections TO runspell_runtime;
GRANT INSERT (workspace_id, label, kind, origin) ON runspell.connections TO runspell_runtime;
GRANT UPDATE (revoked_at) ON runspell.connections TO runspell_runtime;

COMMIT;

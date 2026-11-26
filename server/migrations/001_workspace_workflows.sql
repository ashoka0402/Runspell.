BEGIN;

CREATE SCHEMA runspell;
REVOKE ALL ON SCHEMA runspell FROM PUBLIC;
GRANT USAGE ON SCHEMA runspell TO runspell_runtime;

CREATE TABLE runspell.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_issuer text NOT NULL CHECK (identity_issuer <> ''),
  identity_subject text NOT NULL CHECK (identity_subject <> ''),
  UNIQUE (identity_issuer, identity_subject)
);

CREATE TABLE runspell.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runspell.workspace_members (
  user_id uuid REFERENCES runspell.users (id),
  workspace_id uuid REFERENCES runspell.workspaces (id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE runspell.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES runspell.workspaces (id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  draft_definition jsonb NOT NULL CHECK (jsonb_typeof(draft_definition) = 'object'),
  draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE runspell.workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_by uuid NOT NULL REFERENCES runspell.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, workflow_id) REFERENCES runspell.workflows (workspace_id, id),
  UNIQUE (workspace_id, workflow_id, version_number)
);

ALTER TABLE runspell.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE runspell.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE runspell.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE runspell.workflow_versions ENABLE ROW LEVEL SECURITY;

-- The server will set this internal UUID from verified identity inside each transaction.
CREATE POLICY read_own_memberships ON runspell.workspace_members
  FOR SELECT TO runspell_runtime
  USING (user_id = (SELECT NULLIF(current_setting('runspell.user_id', true), '')::uuid));

CREATE FUNCTION runspell.workspace_role(target_workspace uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
  AS $$
    SELECT role FROM runspell.workspace_members
    WHERE workspace_id = target_workspace
      AND user_id = NULLIF(current_setting('runspell.user_id', true), '')::uuid
  $$;

REVOKE ALL ON FUNCTION runspell.workspace_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION runspell.workspace_role(uuid) TO runspell_runtime;

CREATE POLICY read_workspace ON runspell.workspaces
  FOR SELECT TO runspell_runtime USING (runspell.workspace_role(id) IS NOT NULL);

CREATE POLICY read_workflows ON runspell.workflows
  FOR SELECT TO runspell_runtime USING (runspell.workspace_role(workspace_id) IS NOT NULL);

CREATE POLICY create_workflow ON runspell.workflows
  FOR INSERT TO runspell_runtime
  WITH CHECK (runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor'));

CREATE POLICY edit_workflow ON runspell.workflows
  FOR UPDATE TO runspell_runtime
  USING (runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor'))
  WITH CHECK (runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor'));

CREATE POLICY read_versions ON runspell.workflow_versions
  FOR SELECT TO runspell_runtime USING (runspell.workspace_role(workspace_id) IS NOT NULL);

REVOKE ALL ON ALL TABLES IN SCHEMA runspell FROM PUBLIC, runspell_runtime;
GRANT SELECT ON runspell.workspaces, runspell.workspace_members, runspell.workflows,
  runspell.workflow_versions TO runspell_runtime;
GRANT INSERT (workspace_id, name, draft_definition) ON runspell.workflows TO runspell_runtime;
GRANT UPDATE (name, draft_definition, draft_revision) ON runspell.workflows TO runspell_runtime;

COMMIT;

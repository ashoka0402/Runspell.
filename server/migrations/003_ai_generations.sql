BEGIN;

CREATE TABLE runspell.ai_generations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES runspell.workspaces (id),
  requested_by uuid NOT NULL REFERENCES runspell.users (id),
  workflow_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  result jsonb CHECK (jsonb_typeof(result) = 'object'),
  FOREIGN KEY (workspace_id, workflow_id) REFERENCES runspell.workflows (workspace_id, id)
);

CREATE INDEX ai_generations_workspace_recent ON runspell.ai_generations (workspace_id, created_at);
ALTER TABLE runspell.ai_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_generations ON runspell.ai_generations FOR SELECT TO runspell_runtime
  USING (runspell.workspace_role(workspace_id) IS NOT NULL);

CREATE POLICY start_generation ON runspell.ai_generations FOR INSERT TO runspell_runtime
  WITH CHECK (
    runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor')
    AND requested_by = NULLIF(current_setting('runspell.user_id', true), '')::uuid
  );

CREATE POLICY finish_generation ON runspell.ai_generations FOR UPDATE TO runspell_runtime
  USING (
    runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor')
    AND requested_by = NULLIF(current_setting('runspell.user_id', true), '')::uuid
    AND result IS NULL
  )
  WITH CHECK (
    runspell.workspace_role(workspace_id) IN ('owner', 'admin', 'editor')
    AND requested_by = NULLIF(current_setting('runspell.user_id', true), '')::uuid
    AND result IS NOT NULL
  );

REVOKE ALL ON runspell.ai_generations FROM PUBLIC, runspell_runtime;
GRANT SELECT ON runspell.ai_generations TO runspell_runtime;
GRANT INSERT (id, workspace_id, requested_by, workflow_id) ON runspell.ai_generations TO runspell_runtime;
GRANT UPDATE (result) ON runspell.ai_generations TO runspell_runtime;

COMMIT;

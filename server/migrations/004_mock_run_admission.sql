BEGIN;

ALTER TABLE runspell.workflow_versions
  ADD COLUMN draft_revision integer CHECK (draft_revision >= 0),
  ADD CONSTRAINT workflow_versions_scoped_id UNIQUE (workspace_id, workflow_id, id),
  ADD CONSTRAINT workflow_versions_draft_revision UNIQUE (workspace_id, workflow_id, draft_revision);

ALTER TABLE runspell.workflows
  ADD COLUMN active_mock_version_id uuid,
  ADD CONSTRAINT workflows_active_mock_version
    FOREIGN KEY (workspace_id, id, active_mock_version_id)
    REFERENCES runspell.workflow_versions (workspace_id, workflow_id, id);

CREATE TABLE runspell.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES runspell.users (id),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  status text NOT NULL DEFAULT 'accepted' CHECK (status = 'accepted'),
  mode text NOT NULL DEFAULT 'mock' CHECK (mode = 'mock'),
  trigger_type text NOT NULL DEFAULT 'manual' CHECK (trigger_type = 'manual'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, workflow_id, workflow_version_id)
    REFERENCES runspell.workflow_versions (workspace_id, workflow_id, id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, workflow_id, requested_by, idempotency_key)
);

CREATE INDEX runs_workspace_recent ON runspell.runs (workspace_id, created_at DESC, id);

CREATE TABLE runspell.dispatch_outbox (
  run_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runspell.runs (workspace_id, id)
);

CREATE INDEX dispatch_outbox_oldest ON runspell.dispatch_outbox (created_at, run_id);

ALTER TABLE runspell.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runspell.dispatch_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_runs ON runspell.runs
  FOR SELECT TO runspell_runtime USING (runspell.workspace_role(workspace_id) IS NOT NULL);

REVOKE ALL ON runspell.runs, runspell.dispatch_outbox FROM PUBLIC, runspell_runtime;
GRANT SELECT (id, workspace_id, workflow_id, workflow_version_id, status, mode, trigger_type, created_at)
  ON runspell.runs TO runspell_runtime;

CREATE FUNCTION runspell.activate_mock_workflow(
  target_workspace uuid, target_workflow uuid, expected_revision integer, expected_definition jsonb
)
  RETURNS TABLE (id uuid, version_number integer, draft_revision integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  actor_id uuid := NULLIF(current_setting('runspell.user_id', true), '')::uuid;
  member_role text;
  current_draft runspell.workflows%ROWTYPE;
  version_id uuid;
  next_version integer;
  version_definition jsonb;
BEGIN
  SELECT m.role INTO member_role FROM runspell.workspace_members AS m
  WHERE m.workspace_id = target_workspace AND m.user_id = actor_id FOR SHARE;
  IF member_role IS NULL OR member_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE insufficient_privilege USING MESSAGE = 'Mock activation requires workspace edit access';
  END IF;

  SELECT w.* INTO current_draft FROM runspell.workflows AS w
  WHERE w.workspace_id = target_workspace AND w.id = target_workflow FOR UPDATE;
  IF NOT FOUND OR current_draft.draft_revision IS DISTINCT FROM expected_revision
    OR current_draft.draft_definition IS DISTINCT FROM expected_definition THEN
    RETURN;
  END IF;

  SELECT v.id, v.version_number, v.definition INTO version_id, next_version, version_definition
  FROM runspell.workflow_versions AS v
  WHERE v.workspace_id = target_workspace AND v.workflow_id = target_workflow
    AND v.draft_revision = expected_revision;
  IF NOT FOUND THEN
    SELECT coalesce(max(v.version_number), 0) + 1 INTO next_version FROM runspell.workflow_versions AS v
    WHERE v.workspace_id = target_workspace AND v.workflow_id = target_workflow;

    INSERT INTO runspell.workflow_versions AS v (workspace_id, workflow_id, version_number, draft_revision, definition, created_by)
    VALUES (target_workspace, target_workflow, next_version, expected_revision, current_draft.draft_definition, actor_id)
    RETURNING v.id INTO version_id;
  ELSIF version_definition IS DISTINCT FROM expected_definition THEN
    RETURN;
  END IF;

  UPDATE runspell.workflows AS w SET active_mock_version_id = version_id
  WHERE w.workspace_id = target_workspace AND w.id = target_workflow
    AND w.active_mock_version_id IS DISTINCT FROM version_id;
  RETURN QUERY SELECT version_id, next_version, expected_revision;
END;
$$;

CREATE FUNCTION runspell.admit_mock_run(target_workspace uuid, target_workflow uuid, request_key text)
  RETURNS TABLE (id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  actor_id uuid := NULLIF(current_setting('runspell.user_id', true), '')::uuid;
  member_role text;
  version_id uuid;
  admitted_run_id uuid;
BEGIN
  SELECT m.role INTO member_role FROM runspell.workspace_members AS m
  WHERE m.workspace_id = target_workspace AND m.user_id = actor_id FOR SHARE;
  IF member_role IS NULL OR member_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE insufficient_privilege USING MESSAGE = 'Manual admission requires workspace edit access';
  END IF;
  IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Invalid idempotency key';
  END IF;

  -- This lock serializes activation and admission for the same workflow.
  SELECT w.active_mock_version_id INTO version_id FROM runspell.workflows AS w
  WHERE w.workspace_id = target_workspace AND w.id = target_workflow FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT r.id INTO admitted_run_id FROM runspell.runs AS r
  WHERE r.workspace_id = target_workspace AND r.workflow_id = target_workflow
    AND r.requested_by = actor_id AND r.idempotency_key = request_key;
  IF FOUND THEN
    RETURN QUERY SELECT admitted_run_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM runspell.workflow_versions AS v
    WHERE v.workspace_id = target_workspace AND v.workflow_id = target_workflow AND v.id = version_id
      AND v.definition->'triggers' @> '[{"type":"manual"}]'::jsonb
  ) THEN
    RETURN;
  END IF;

  INSERT INTO runspell.runs AS r (workspace_id, workflow_id, workflow_version_id, requested_by, idempotency_key)
  VALUES (target_workspace, target_workflow, version_id, actor_id, request_key)
  RETURNING r.id INTO admitted_run_id;
  INSERT INTO runspell.dispatch_outbox (run_id, workspace_id) VALUES (admitted_run_id, target_workspace);
  RETURN QUERY SELECT admitted_run_id;
END;
$$;

REVOKE ALL ON FUNCTION runspell.activate_mock_workflow(uuid, uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION runspell.admit_mock_run(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION runspell.activate_mock_workflow(uuid, uuid, integer, jsonb) TO runspell_runtime;
GRANT EXECUTE ON FUNCTION runspell.admit_mock_run(uuid, uuid, text) TO runspell_runtime;

COMMIT;

BEGIN;

ALTER TABLE runspell.runs
  DROP CONSTRAINT runs_status_check,
  ADD COLUMN finished_at timestamptz,
  ADD COLUMN result jsonb,
  ADD CONSTRAINT runs_status_check CHECK (status IN ('accepted', 'succeeded', 'failed')),
  ADD CONSTRAINT runs_mock_outcome_check CHECK (
    (status = 'accepted' AND finished_at IS NULL AND result IS NULL)
    OR (
      status IN ('succeeded', 'failed')
      AND finished_at IS NOT NULL
      AND jsonb_typeof(result) = 'object'
      AND result->>'evidence' IS NOT DISTINCT FROM 'simulated'
    )
  );

GRANT SELECT (finished_at, result) ON runspell.runs TO runspell_runtime;
GRANT USAGE ON SCHEMA runspell TO runspell_mock_worker;

CREATE FUNCTION runspell.claim_mock_run()
  RETURNS TABLE (id uuid, definition jsonb)
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT r.id, v.definition
    FROM runspell.dispatch_outbox AS o
    JOIN runspell.runs AS r ON r.workspace_id = o.workspace_id AND r.id = o.run_id
    JOIN runspell.workflow_versions AS v
      ON v.workspace_id = r.workspace_id AND v.workflow_id = r.workflow_id AND v.id = r.workflow_version_id
    WHERE r.mode = 'mock' AND r.status = 'accepted'
    ORDER BY o.created_at, o.run_id
    LIMIT 1
    FOR UPDATE OF o SKIP LOCKED
  $$;

CREATE FUNCTION runspell.finish_mock_run(target_run uuid, final_status text, simulated_result jsonb)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  target_workspace uuid;
BEGIN
  IF final_status IS NULL OR final_status NOT IN ('succeeded', 'failed')
    OR jsonb_typeof(simulated_result) IS DISTINCT FROM 'object'
    OR simulated_result->>'evidence' IS DISTINCT FROM 'simulated'
    OR octet_length(simulated_result::text) > 65536 THEN
    RAISE invalid_parameter_value USING MESSAGE = 'Invalid mock run outcome';
  END IF;

  SELECT o.workspace_id INTO target_workspace
  FROM runspell.dispatch_outbox AS o
  JOIN runspell.runs AS r ON r.workspace_id = o.workspace_id AND r.id = o.run_id
  WHERE o.run_id = target_run AND r.mode = 'mock' AND r.status = 'accepted'
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE runspell.runs AS r
  SET status = final_status, result = simulated_result, finished_at = clock_timestamp()
  WHERE r.workspace_id = target_workspace AND r.id = target_run AND r.mode = 'mock' AND r.status = 'accepted';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  DELETE FROM runspell.dispatch_outbox AS o WHERE o.workspace_id = target_workspace AND o.run_id = target_run;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION runspell.claim_mock_run() FROM PUBLIC, runspell_runtime;
REVOKE ALL ON FUNCTION runspell.finish_mock_run(uuid, text, jsonb) FROM PUBLIC, runspell_runtime;
GRANT EXECUTE ON FUNCTION runspell.claim_mock_run() TO runspell_mock_worker;
GRANT EXECUTE ON FUNCTION runspell.finish_mock_run(uuid, text, jsonb) TO runspell_mock_worker;

COMMIT;

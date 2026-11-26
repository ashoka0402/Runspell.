\set ON_ERROR_STOP on

BEGIN;

INSERT INTO runspell.users (id, identity_issuer, identity_subject) VALUES
    ('10000000-0000-4000-8000-000000000001', 'https://identity.example.test', 'editor'),
    ('10000000-0000-4000-8000-000000000002', 'https://identity.example.test', 'viewer'),
    ('10000000-0000-4000-8000-000000000003', 'https://identity.example.test', 'owner'),
    ('10000000-0000-4000-8000-000000000004', 'https://identity.example.test', 'nonmember');

INSERT INTO runspell.workspaces (id, name) VALUES
    ('20000000-0000-4000-8000-000000000001', 'Workspace A'),
    ('20000000-0000-4000-8000-000000000002', 'Workspace B');

INSERT INTO runspell.workspace_members (workspace_id, user_id, role) VALUES
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'editor'),
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'viewer'),
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'admin'),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'owner');

INSERT INTO runspell.workflows (id, workspace_id, name, draft_definition) VALUES
    ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Draft A', '{"schemaVersion":1}'),
    ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Draft B', '{"schemaVersion":1}');

INSERT INTO runspell.workflow_versions (workspace_id, workflow_id, version_number, definition, created_by) VALUES
    ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, '{"schemaVersion":1}', '10000000-0000-4000-8000-000000000001'),
    ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 1, '{"schemaVersion":1}', '10000000-0000-4000-8000-000000000003');

DO $$
BEGIN
    BEGIN
        INSERT INTO runspell.workflow_versions (workspace_id, workflow_id, version_number, definition, created_by)
        VALUES ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 2, '{"schemaVersion":1}', '10000000-0000-4000-8000-000000000001');
        RAISE EXCEPTION 'A version referenced a different workspace workflow';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
END;
$$;

SET LOCAL ROLE runspell_runtime;

DO $$
BEGIN
    IF EXISTS (SELECT FROM runspell.workspaces)
        OR EXISTS (SELECT FROM runspell.workspace_members)
        OR EXISTS (SELECT FROM runspell.workflows)
        OR EXISTS (SELECT FROM runspell.workflow_versions) THEN
        RAISE EXCEPTION 'The runtime role read workspace data without an actor';
    END IF;
END;
$$;

SET LOCAL runspell.user_id = '10000000-0000-4000-8000-000000000004';

DO $$
BEGIN
    IF EXISTS (SELECT FROM runspell.workspaces)
        OR EXISTS (SELECT FROM runspell.workspace_members)
        OR EXISTS (SELECT FROM runspell.workflows)
        OR EXISTS (SELECT FROM runspell.workflow_versions) THEN
        RAISE EXCEPTION 'A user without membership read workspace data';
    END IF;
END;
$$;

SET LOCAL runspell.user_id = '10000000-0000-4000-8000-000000000002';

DO $$
BEGIN
    IF (SELECT array_agg(name) FROM runspell.workspaces) IS DISTINCT FROM ARRAY['Workspace A']::text[]
        OR (SELECT array_agg(name) FROM runspell.workflows) IS DISTINCT FROM ARRAY['Draft A']::text[]
        OR (SELECT array_agg(workflow_id::text) FROM runspell.workflow_versions)
            IS DISTINCT FROM ARRAY['30000000-0000-4000-8000-000000000001']::text[]
        OR (SELECT array_agg(user_id::text) FROM runspell.workspace_members)
            IS DISTINCT FROM ARRAY['10000000-0000-4000-8000-000000000002']::text[] THEN
        RAISE EXCEPTION 'Viewer visibility did not match their membership';
    END IF;

    UPDATE runspell.workflows SET name = 'Forbidden viewer edit'
    WHERE id = '30000000-0000-4000-8000-000000000001';
    IF FOUND THEN
        RAISE EXCEPTION 'Viewer updated a draft';
    END IF;

    BEGIN
        INSERT INTO runspell.workflows (workspace_id, name, draft_definition)
        VALUES ('20000000-0000-4000-8000-000000000001', 'Forbidden viewer draft', '{"schemaVersion":1}');
        RAISE EXCEPTION 'Viewer created a workflow';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$$;

SET LOCAL runspell.user_id = '10000000-0000-4000-8000-000000000001';

DO $$
BEGIN
    INSERT INTO runspell.workflows (workspace_id, name, draft_definition)
    VALUES ('20000000-0000-4000-8000-000000000001', 'New editor draft', '{"schemaVersion":1}');

    UPDATE runspell.workflows SET name = 'Edited draft', draft_revision = draft_revision + 1
    WHERE id = '30000000-0000-4000-8000-000000000001' AND draft_revision = 0;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Editor could not update their workspace draft';
    END IF;

    UPDATE runspell.workflows SET name = 'Stale draft', draft_revision = draft_revision + 1
    WHERE id = '30000000-0000-4000-8000-000000000001' AND draft_revision = 0;
    IF FOUND THEN
        RAISE EXCEPTION 'A stale revision matched the updated draft';
    END IF;

    UPDATE runspell.workflows SET name = 'Forbidden cross-workspace edit'
    WHERE id = '30000000-0000-4000-8000-000000000002';
    IF FOUND THEN
        RAISE EXCEPTION 'Editor updated a cross-workspace draft';
    END IF;

    BEGIN
        INSERT INTO runspell.workflows (workspace_id, name, draft_definition)
        VALUES ('20000000-0000-4000-8000-000000000002', 'Forbidden cross-workspace draft', '{"schemaVersion":1}');
        RAISE EXCEPTION 'Editor created a cross-workspace draft';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        UPDATE runspell.workspace_members SET role = 'owner'
        WHERE user_id = '10000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'Editor could change membership privileges';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        UPDATE runspell.workflow_versions SET definition = '{"schemaVersion":2}'
        WHERE workflow_id = '30000000-0000-4000-8000-000000000001' AND version_number = 1;
        RAISE EXCEPTION 'The runtime role could update a stored version';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        DELETE FROM runspell.workflow_versions
        WHERE workflow_id = '30000000-0000-4000-8000-000000000001' AND version_number = 1;
        RAISE EXCEPTION 'The runtime role could delete a stored version';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        INSERT INTO runspell.workflow_versions (workspace_id, workflow_id, version_number, definition, created_by)
        VALUES ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 2, '{"schemaVersion":1}', '10000000-0000-4000-8000-000000000001');
        RAISE EXCEPTION 'The runtime role could publish a version directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$$;

SET LOCAL runspell.user_id = '10000000-0000-4000-8000-000000000003';

DO $$
BEGIN
    IF (SELECT count(*) FROM runspell.workspaces) <> 2 THEN
        RAISE EXCEPTION 'The user with two memberships could not see both workspaces';
    END IF;

    BEGIN
        UPDATE runspell.workflows SET workspace_id = '20000000-0000-4000-8000-000000000002'
        WHERE id = '30000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'A user with edit access to both workspaces could move a workflow';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    IF has_table_privilege(current_user, 'runspell.users', 'SELECT')
        OR has_table_privilege(current_user, 'runspell.workflow_versions', 'TRUNCATE') THEN
        RAISE EXCEPTION 'The runtime role has privileged access to identity or version data';
    END IF;
END;
$$;

RESET runspell.user_id;

DO $$
BEGIN
    IF EXISTS (SELECT FROM runspell.workspaces)
        OR EXISTS (SELECT FROM runspell.workspace_members)
        OR EXISTS (SELECT FROM runspell.workflows)
        OR EXISTS (SELECT FROM runspell.workflow_versions) THEN
        RAISE EXCEPTION 'Workspace data remained visible after the actor was reset';
    END IF;
END;
$$;

ROLLBACK;
\echo Workspace authorization and workflow version checks passed.

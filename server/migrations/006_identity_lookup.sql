BEGIN;

GRANT USAGE ON SCHEMA runspell TO runspell_identity_lookup;

CREATE FUNCTION runspell.resolve_identity(verified_issuer text, verified_subject text)
  RETURNS uuid
  LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id FROM runspell.users AS u
    WHERE u.identity_issuer = verified_issuer AND u.identity_subject = verified_subject
  $$;

REVOKE ALL ON FUNCTION runspell.resolve_identity(text, text) FROM PUBLIC, runspell_runtime, runspell_mock_worker;
GRANT EXECUTE ON FUNCTION runspell.resolve_identity(text, text) TO runspell_identity_lookup;

COMMIT;

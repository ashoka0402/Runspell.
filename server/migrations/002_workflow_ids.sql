BEGIN;

-- Allocate the UUID before compiling so the stored definition and row share an identity.
GRANT INSERT (id) ON runspell.workflows TO runspell_runtime;

COMMIT;

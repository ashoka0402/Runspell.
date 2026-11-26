BEGIN;

ALTER TABLE runspell.ai_generations
  DROP CONSTRAINT ai_generations_pkey,
  ADD PRIMARY KEY (workspace_id, id);

COMMIT;

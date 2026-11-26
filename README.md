# Runspell project

The [roadmap](ROADMAP.md) tracks the Runspell plan and progress. The landing page and workspace run together as a static preview. No frontend build or package installation is required.

Run from this directory:

```powershell
py scripts/preview.py
```

Open [the landing page](http://localhost:8000/) and select **Open workspace**, or open [the workspace](http://localhost:8000/app/#/overview) directly. Serve the files over HTTP so the landing page's JavaScript module loads correctly.

- `index.html`: landing page and sample workflow markup.
- `relay-source/`: landing styles, workflow simulation, charts, calculator, and animated canvas.
- `app/`: workspace, hash-based navigation, and scenario editor.

This is a preview with sample data and simulated runs. There is no backend or authentication. Saved workflow drafts use browser local storage; the existing `brisko.workflow.drafts` key is retained. Google Fonts load when online, with system font fallbacks.

Run the integration checks from this directory:

```powershell
py -m unittest discover -s tests -v
```

## M0 offline compatibility lab

The original landing page and workspace remain buildless. The opt-in React Flow/GSAP lab uses pinned npm dependencies and a generated isolated bundle:

```powershell
npm ci
npm run build
```

With the local server running, open [the M0 lab](http://localhost:8000/app/#/m0). This displays a validated fixture, not a real automation or AI-generated result.

```powershell
npm run typecheck
npm test
npm run test:browser
```

Browser checks use installed Google Chrome and the Windows Python `py` launcher. See [M0 contracts and feasibility](docs/M0.md) for scope, verification evidence, and the pending live provider gate, and [the roadmap](ROADMAP.md) for later milestones. Trigger.dev and Steel checks remain offline as requested.

## M1 offline Prompt Studio

After `npm run build`, open [Prompt Studio](http://localhost:8000/app/#/studio) from the workspace. It builds and edits one validated invoice fixture, saves accepted draft changes in browser local storage, and supports reviewed mock revisions. It cannot connect accounts, activate a workflow, or run external actions. See [M1 verification and limits](docs/M1.md).

## M2 PostgreSQL checks

With PostgreSQL's `initdb`, `pg_ctl`, and `psql` on your PATH, run `npm run test:db` as a regular user. The suite starts a temporary cluster on a free loopback port, applies the migrations, and checks the workspace policies and workflow draft API before removing the cluster. The API tests use Fastify injection and a test identity resolver. See the [backend plan](BACKEND_PLAN.md#15-development-deployment-and-recovery) for the runtime authorization contract.

## M3 Gemini configuration

Copy `.env.example` to `.env` if the file is missing. Set `GEMINI_API_KEY` in `.env` and keep that file private. The default model in the template is [Gemini 3.1 Flash-Lite](https://aistudio.google.com/docs/models/gemini-3.1-flash-lite).

For a live check with a synthetic prompt, set `RUNSPELL_ENABLE_GEMINI=true` and run `npm run test:gemini-live`. This sends one model request with a fixed example and validates the resulting draft locally. It may consume provider quota. Automated tests use simulated responses.

The API reads these options from its Node environment. A server process can load them with `--env-file=.env`. Use the loopback preview above, which serves only the public frontend assets. The current Prompt Studio still uses local fixtures.

## M4 manual mock runs

`npm run test:db` also verifies mock activation, idempotent admission, and local dispatch through PostgreSQL. For manual dispatch against a migrated development database, set `RUNSPELL_MOCK_DATABASE_URL` in the private `.env` using the dedicated mock worker login and run `npm run dispatch:mock`. Each invocation processes one pending mock run and stores a receipt with simulated outputs. See the [backend plan](BACKEND_PLAN.md#10-http-api-surface) for the API and role requirements.

## M5 Flight Recorder

In the local workspace, open **Runs → Flight Recorder** at `/app/#/runs/recorder`. Use **Open receipt** to inspect a JSON file downloaded from the authorized `/api/v1/workspaces/:wid/runs/:id/receipt` endpoint. The recorder displays the pinned version, outcome, and timeline in that browser tab. Mock receipts show simulated evidence. See the [backend plan](BACKEND_PLAN.md#10-http-api-surface) for the receipt format and access requirements.

## Local API with managed identity

Set the database and OIDC options from `.env.example` in the private `.env`, then run `npm run api:local`. It listens on `127.0.0.1:8002`. The API accepts short-lived RS256 access tokens with type `at+jwt`, the configured issuer and audience, and a subject already provisioned in Runspell. The development database needs separate runtime and identity-lookup logins. See the [backend plan](BACKEND_PLAN.md#15-development-deployment-and-recovery) for role setup. `npm run test:db` verifies the routes with local signing keys.

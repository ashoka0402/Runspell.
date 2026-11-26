# Runspell project

The [roadmap](ROADMAP.md) tracks the Runspell plan and progress. The landing page and workspace run together as a static preview. No frontend build or package installation is required.

Run from this directory:

```powershell
py -m http.server 8000 --bind 127.0.0.1
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

With PostgreSQL's `initdb`, `pg_ctl`, and `psql` on your PATH, run `npm run test:db` as a regular user. The suite creates a temporary cluster on a free loopback port, applies the migration, tests workspace access under the runtime role, and removes the cluster. It uses synthetic fixtures and does not connect to your existing database. See the [backend plan](BACKEND_PLAN.md#15-development-deployment-and-recovery) for the runtime authorization contract.

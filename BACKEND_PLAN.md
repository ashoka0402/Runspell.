# Runspell backend implementation plan

M2 is in progress. The PostgreSQL workspace schema and Fastify draft API are implemented for local integration. See the [roadmap](ROADMAP.md) for delivery order and progress.

## 1. Product and operating model

Runspell will run workflows that combine events, APIs, browser actions, and human decisions.

The default is to use official APIs for supported actions and webhooks for incoming events. Use browser automation when an appropriate API is unavailable or cannot perform the required action. API authentication may use an API key or OAuth; a missing API key alone does not require browser automation.

The UI can offer two starting templates:

| Template | Typical workflow |
| --- | --- |
| Browser automation | Schedule → open a portal → download an invoice → save the result |
| Event automation | Receive an order webhook → validate the order → call an API → notify someone |

Both templates use the same workflow model. An event can start browser actions, and a browser workflow can call APIs.

Each workflow has validated inputs, ordered actions, optional conditions and approvals, and defined outputs. A workflow may have multiple trigger bindings, such as a schedule and webhook, and may also be started manually. Each run records exactly one initiating source. The first version supports sequential steps with simple conditional branches. General graphs, cycles, and arbitrary user code are deferred.

## 2. Existing application and integration scope

The repository currently contains:

- `index.html` and `relay-source/`: the integrated landing page and interactive demo.
- `app/`: the workspace, navigation, scenario editor, and simulated runs.
- Browser-local workflow drafts under `brisko.workflow.drafts` and the offline Prompt Studio under `relay.studio.v1`. The Runspell frontend continues to use both storage keys for compatibility.
- `tests/test_frontend.py`: existing static integration checks.

The backend will replace workspace sample data incrementally. The public landing page remains a demonstration. Production actions must be clearly distinguished from simulations.

Keep the static frontend and isolated React/TypeScript editor while adding API calls. Evaluate Next.js separately if a product requirement justifies migration.

## 3. Proposed stack and ownership

| Component | Selection | Responsibility |
| --- | --- | --- |
| HTTP API | Node.js LTS, TypeScript, Fastify | Authentication integration, authorization, validation, workflow management, run requests |
| Database | Managed PostgreSQL | Workspaces, workflow versions, connections, run records, approvals, durable dispatch |
| Orchestration | Trigger.dev Cloud | Durable tasks, schedules, retries, concurrency limits, waiting for decisions |
| Browser infrastructure | Steel Cloud | Remote browser sessions and saved browser profiles |
| Browser control | Playwright | Execute supported browser actions through Steel's CDP connection |
| Identity | Clerk or the existing managed authentication provider | User sign-in and identity verification, validated before service integration |
| AI authoring | Gemini via a provider-neutral adapter | M3 structured draft generation and reviewable conversational edits |
| File storage | Private S3-compatible object storage | Downloaded files, screenshots, and retained artifacts |
| Validation | Fastify route schemas and shared workflow schemas | Reject invalid requests and unsupported workflow definitions |

Trigger.dev and Steel are confirmed product choices. Fastify, managed PostgreSQL, managed identity, and object storage are recommended implementation defaults. Hosting vendors, regions, and identity/storage providers remain open decisions.

Use one repository and one API service. Trigger.dev hosts the background workers. Use ordinary SQL migrations and parameterized queries initially; add an ORM only if implementation demonstrates a need. Avoid introducing Redis, a second job queue, microservices, or an AI framework in the first version.

Provider capabilities are documented in [Trigger.dev tasks](https://trigger.dev/docs/tasks/overview), [Steel's Playwright integration](https://steel.dev/docs/integrations/playwright), and [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/). Pin compatible dependency versions during implementation.

## 4. Request and execution flow

### Manual execution

1. The signed-in user requests a run through our API.
2. The API checks workspace membership, role, workflow status, inputs, connections, and quotas.
3. A database transaction creates the run and a pending dispatch record.
4. A dispatcher submits the run ID to Trigger.dev with a stable idempotency key.
5. The task loads the run's immutable workflow version and executes supported steps.
6. Browser steps create a Steel session only when needed; API-only workflows create none.
7. The task saves step results, artifacts, and terminal status to PostgreSQL.
8. The frontend reads progress through authorized API requests.

Return `202 Accepted` with our run ID after the run and dispatch intent are durably stored. This acknowledges acceptance, not successful completion.

### Event execution

Prefer Trigger.dev's native webhook ingestion for supported providers. A registered endpoint maps to a specific connection/workspace; never use an unverified workspace ID from the event body as authority.

The event handler validates and normalizes the payload, records the provider event ID, resolves matching active workflows, and creates their runs transactionally. Apply the same run/version/dispatch rules used for manual execution. [Trigger.dev webhooks](https://trigger.dev/docs/webhooks/overview)

For a provider requiring our own ingress endpoint, verify its signature using the raw request body and provider-specific replay rules. Store the event and dispatch intent before acknowledging it. Duplicate deliveries acknowledge the original event without creating another run for the same workflow.

If a provider has no webhook, add scheduled API polling only for a specific connector that needs it. Track a durable cursor and deduplicate discovered events. Browser-based polling is an explicit, costlier fallback.

### Scheduled execution

Use Trigger.dev schedules associated with our trigger records. Store the IANA timezone, provider schedule ID, and next expected execution. Default the user's schedule editor to `Asia/Kolkata`, while storing timestamps in UTC.

Deduplicate occurrences using the trigger ID and scheduled timestamp. Define overlap behavior as queue or skip; expire stale scheduled work when it is no longer useful. Configure scheduling windows deliberately and display the actual next-run time. Reconcile failed schedule activation/deactivation with our trigger records. [Scheduled tasks](https://trigger.dev/docs/tasks/scheduled)

## 5. Workflow definition and versioning

The server accepts a constrained JSON definition containing:

- Schema version, workflow name, and validated input fields.
- Trigger configuration, separate from credentials.
- Steps with stable IDs, supported action types, typed configuration, and connection references.
- References to trigger inputs or earlier step outputs.
- Simple conditions, explicit approval points, and output mappings.
- Runtime policy: timeout, retry safety, and execution limits.

References use a small, documented syntax. Resolve only permitted fields; do not use `eval`, user-supplied JavaScript, or arbitrary template execution. Validate types and reject missing references before activation.

Keep editable draft definitions separate from immutable activated versions. Every run is pinned to a version. Editing a draft does not change an active run. Activation validates the full definition and required connections.

Pausing a workflow blocks new executions; it does not silently cancel existing ones. Cancellation is a separate action. Draft testing creates an immutable test snapshot, uses explicit inputs, and applies the same permissions and limits as other runs.

## 6. Supported actions

| Group | First-version capabilities | Behavior |
| --- | --- | --- |
| Browser | Open URL, click, fill, wait for element, extract fields, download, screenshot | Execute with Playwright using approved URLs and structured selectors |
| API | Make an authenticated HTTP request | Validate destinations, methods, headers, payloads, response limits, and output schema |
| Data | Map input/output fields and evaluate simple conditions | Use a constrained expression format with no executable code |
| Approval | Request a decision with an expiry | Authorized reviewer approves or rejects the pending action |
| Output | Save structured results and files; deliver an outgoing webhook | Record delivery status and apply destination and retry controls |

Start with one real website and one API/event provider. Notifications can initially use a configured outgoing webhook; email, Slack, Sheets, and other named integrations are added when required by a selected workflow.

Use stable accessible locators where available and bounded waits for expected page state. Check extracted values against a schema. Capture useful failure evidence without recording passwords or unnecessary personal data.

There is no automatic switch from a failed API request to browser execution: each action's execution method is explicit. Expired credentials produce a reconnect requirement rather than an unexpected browser login attempt.

## 7. Browser connections and session lifecycle

### Connect an account

1. An authorized member creates a browser connection for an approved site.
2. The backend opens a short-lived Steel login session and associates it with that connection.
3. The user completes sign-in and any MFA through a supported, authorized viewer/handoff flow.
4. Verify login using a site-specific check, then release the session and confirm the saved profile is ready.
5. Store the Steel profile ID and connection metadata, scoped to the workspace and account.

Validate Steel viewer access and embedding behavior during the first integration spike. Viewer URLs and session connection URLs are sensitive capabilities; do not put them in public pages, analytics, or ordinary logs. If secure embedding is unavailable, use an authenticated handoff supported by Steel.

A profile can preserve browser state, but it does not preserve open tabs or guarantee that a website keeps a login valid. [Steel profiles](https://steel.dev/docs/logins/profiles), [browser state](https://steel.dev/docs/logins/browser-state)

### Execute browser work

- Acquire exclusive access to a connection/profile across login sessions, workflow sessions, and retries. Use an expiring database lease with heartbeat and ownership checks where Trigger task limits alone cannot cover all paths.
- Create a Steel session with hard and inactivity timeouts; persist its ID immediately for cleanup and reconciliation.
- Connect Playwright through CDP and verify the authenticated state before acting.
- Reuse that session for consecutive browser steps in the run.
- On completion, close the client connection and explicitly release the Steel session in cleanup code. A closed Playwright connection does not itself release Steel.
- On cancellation or worker failure, use recorded session IDs and a reconciliation task to release orphan sessions. Timeouts provide a final bound when cleanup cannot run.
- Release leases only after session release is confirmed, or quarantine the connection until reconciliation proves the old session ended.

Steel bills for the lifetime of a live session. Set a browser budget separately from the task's execution budget. [Steel session lifecycle](https://steel.dev/docs/sessions/lifecycle)

### Long waits and approvals

Place long approval waits before opening a browser whenever possible. Otherwise, save the necessary business state, release the session, and create a new session after approval. Revalidate login, page state, prices, identifiers, and the proposed action before continuing.

Trigger.dev waitpoints do not keep an external browser alive automatically, and releasing a browser loses its open tabs. Never assume a browser/socket object remains valid after a durable wait. Use an approval timeout and an explicit rejection/expiry outcome. [Wait for token](https://trigger.dev/docs/wait-for-token)

Bind each approval to the workflow version, step, target, and proposed action details. Atomically change a still-pending, unexpired approval to its authorized decision before signalling Trigger.dev; duplicate or late decisions cannot overwrite it. Retain pending signal-delivery state and retry failed or interrupted delivery through reconciliation. Treat completion as idempotent and resolve already-completed/expired token outcomes explicitly. The resumed worker reads the authoritative decision and current cancellation state before acting. Changed action details require fresh approval. Keep wait-token completion credentials server-side.

## 8. Reliable execution and retry policy

### Durable dispatch

Use a small PostgreSQL outbox for the transaction between our run record and Trigger.dev. It records dispatch intent, attempt count, next attempt, and acknowledgement. An immediate dispatch attempt handles the normal case; a periodic Trigger task retries unacknowledged records.

Use our run ID as the Trigger submission idempotency key. If the API crashes after submission but before recording acknowledgement, retry the same submission. Persist Trigger's run ID once known. The worker also checks our run state and execution ownership before processing; provider idempotency expiry must not recreate completed business actions.

This outbox handles delivery between systems; Trigger.dev remains the job execution system. [Trigger.dev idempotency](https://trigger.dev/docs/idempotency)

### Step outcomes

Persist step state before and after execution. Store attempt number, timestamps, sanitized inputs/outputs, external reference, and error category. Skip already completed actions during a retry only when their recorded results remain valid for the current workflow version and attempt semantics.

A completed step record does not recreate browser page state. After creating a replacement session, rebuild the required read-only navigation and revalidate state before continuing; never replay an external write merely to reconstruct the page.

| Failure | Default handling |
| --- | --- |
| Temporary network failure, provider throttling, transient server error | Bounded retries with backoff/jitter and provider retry guidance |
| Invalid input, unsupported step, missing connection | Fail with an actionable error |
| Expired API token or website login | Refresh safely where supported; otherwise require reconnect |
| Browser selector no longer matches | Fail with sanitized screenshot/context for correction |
| Submission result is unknown after a timeout | Reconcile against external state; otherwise stop for human review |
| Explicit rejection or approval expiry | End without performing the proposed action |

Classify steps as read-only or state-changing. A generic click defaults to potentially state-changing. API writes use the provider's idempotency mechanism when available. Browser writes require a supported verification strategy before automatic retries are allowed.

Do not promise exactly-once execution across external websites. If an invoice was submitted or a payment initiated before a connection dropped, retrying may duplicate it. Check external identifiers/status first; unresolved outcomes become `needs_attention`.

### User-requested retries

A retry creates a linked run pinned to the original workflow version and validated input snapshot. It is allowed only after the source run has stopped executing and its browser cleanup is confirmed. Preserve the root logical execution ID, per-action operation keys, external identifiers, and verified completed results across that run family. Trigger submission keys identify individual runs; external write idempotency keys identify the logical action and remain stable across retries.

The retry resumes safe remaining work, reconstructing read-only browser prerequisites as necessary. Verify or reconcile earlier writes instead of repeating them. An uncertain write blocks automatic continuation. Any changed input or workflow version requires a new execution with explicit intent to perform its actions again, rather than being presented as a retry.

### Concurrency, cancellation, and recovery

- Enforce a global browser cap within the Steel account's available capacity, plus per-workspace quotas and per-connection exclusivity.
- Use Trigger.dev concurrency controls for task scheduling and the connection lease for shared browser state. [Concurrency documentation](https://trigger.dev/docs/concurrency)
- Set bounded task duration, browser duration, API timeouts, step counts, payload sizes, and artifact sizes.
- Cancellation sets `cancel_requested`, requests provider cancellation, and releases any active browser. Confirm cleanup before showing `cancelled`.
- Run a periodic reconciler for orphan sessions, stale leases, missing dispatch acknowledgements, provider/API state divergence, and stuck runs.
- Workers check cancellation and connection revocation before each action. A completed external action cannot be undone by cancelling the remaining run.

## 9. Data model

The following are logical tables. Add them with the phase that needs them, rather than building unused modules first.

| Table | Core fields/purpose |
| --- | --- |
| `users` | Internal ID and verified identity-provider subject |
| `workspaces` | Name, timezone, configured limits |
| `workspace_members` | Workspace/user, role; unique membership |
| `workflows` | Workspace, name, draft definition, revision, active version, status |
| `workflow_versions` | Workflow/version number, immutable definition, creator, timestamp |
| `triggers` | Workflow, type, provider/schedule reference, configuration, enabled state |
| `connections` | Workspace, provider/site, credential reference or encrypted value, Steel profile ID, status, lease metadata |
| `incoming_events` | Workspace/connection, provider event ID, validated payload reference, receipt time, processing state |
| `runs` | Workspace, workflow version, trigger/event reference, parent run/root execution IDs, mode, status, input/output, Trigger run ID, Steel session ID, usage and timing |
| `run_steps` | Run/step/attempt, execution state, external action reference, sanitized output, error |
| `dispatch_outbox` | Run, dispatch status, retry metadata, provider acknowledgement |
| `approvals` | Run/step, requested action and version, approver policy, token reference, expiry, decision and actor |
| `artifacts` | Run/step, private object key, content type, size, retention deadline |
| `audit_events` | Workspace, actor, action, target, timestamp, redacted metadata |

Use UUIDs, UTC timestamps, JSONB for workflow definitions and bounded structured results, foreign keys, and appropriate workspace/status/time indexes. Keep file bodies in object storage.

Enforce workspace consistency with database constraints/composite references as well as application checks. Database uniqueness covers event receipt, event-to-workflow run creation, version numbers, manual request idempotency, and approval decisions. Keep deduplication records long enough for the supported replay window.

Run states: `accepted`, `queued`, `running`, `waiting_for_approval`, `cancel_requested`, `succeeded`, `failed`, `cancelled`, `rejected`, `expired`, `needs_attention`. Run summaries and UI labels must distinguish dispatch failure, execution failure, and uncertain external outcomes.

## 10. HTTP API surface

Use `/api/v1`, validate request and response shapes, and document the API with OpenAPI. Workspace routes require verified identity and membership.

| Endpoint | Purpose |
| --- | --- |
| `GET /me` | Current identity and workspace memberships |
| `GET /workspaces/:wid/overview` | Real workspace summary metrics |
| `GET/POST /workspaces/:wid/workflows` | List/create workflows |
| `GET/PATCH /workspaces/:wid/workflows/:id` | Read/update draft with revision checking |
| `POST /workspaces/:wid/workflows/:id/activate` | Validate and activate an immutable version |
| `POST /workspaces/:wid/workflows/:id/pause` | Stop accepting new runs |
| `POST /workspaces/:wid/workflows/:id/runs` | Start a run with an idempotency key |
| `GET/POST /workspaces/:wid/workflows/:id/triggers` | Inspect/configure webhook or schedule triggers |
| `PATCH/DELETE /workspaces/:wid/workflows/:id/triggers/:tid` | Update/disable/remove a trigger |
| `GET/POST /workspaces/:wid/connections` | List/create API or browser connections |
| `POST /workspaces/:wid/connections/:id/login` | Begin authorized browser login/reconnect |
| `GET /workspaces/:wid/connections/:id/login` | Read login progress and authorized handoff information |
| `POST /workspaces/:wid/connections/:id/login/complete` | Request server verification and profile persistence |
| `DELETE /workspaces/:wid/connections/:id` | Revoke connection and stop future use |
| `GET /workspaces/:wid/runs` | Paginated/filterable history |
| `GET /workspaces/:wid/runs/:id` | Run details, steps, and sanitized outputs |
| `POST /workspaces/:wid/runs/:id/cancel` | Request cancellation |
| `POST /workspaces/:wid/runs/:id/retry` | Create a linked retry run after validating retry safety |
| `POST /workspaces/:wid/approvals/:id/decision` | Approve/reject once, subject to role and expiry |
| `GET /workspaces/:wid/artifacts/:id` | Authorize a short-lived download |
| `POST /webhooks/:endpointId` | Optional custom provider ingress when native ingestion is unsuitable |
| `GET /health/live` and `GET /health/ready` | Process liveness and dependency readiness |

Paths in this table are relative to `/api/v1`. Webhook ingress uses provider verification instead of user-session authentication. It is not a public endpoint for arbitrary run requests.

Use cursor pagination, consistent error codes, request correlation IDs, `409` for stale draft revisions, and explicit rate-limit responses. Expose sanitized errors; keep secrets and provider tokens out of responses.

The implemented draft routes list, create, read, and replace drafts. Collection reads return up to 50 summaries and a nullable `nextCursor` for the `after` query parameter. Item reads and writes include the stored definition. Creation accepts `{ definition }`, and replacement accepts `{ expectedRevision, definition }`. Clients omit the definition's `id` and `workspaceId` on writes. The server derives both from the route and row UUIDs. An empty graph can be saved as an inert draft. A populated graph must pass the shared compiler against server-approved origins. Explicit connection IDs require the future connection service.

The planning API accepts `{ prompt }` on `POST /workspaces/:wid/ai/generations`. It records the outcome and returns the generation ID after a bounded provider round trip. An edit request on `POST /workspaces/:wid/workflows/:id/draft/ai-edit` also requires `expectedRevision`. Successful edits return proposed definitions for review. `POST /workspaces/:wid/workflows/:id/draft/apply-patch` accepts a stored `generationId` and replaces the draft only at the proposal's expected revision. Viewers can read their workspace's outcomes. Generation reads and finite SSE replay use `/workspaces/:wid/ai/generations/:gid` and its `/events` suffix. Replay requires the generation ID and supports `Last-Event-ID`. Recovery without the original response and browser event consumption remain future work.

Gemini is opt-in and authoring-only. One workspace can have one active planning request and make up to ten attempts in a rolling 24-hour window. The adapter limits request size, output tokens, and duration. Persist the validated output, assumptions, required connection types, and reported token usage when available. Raw prompts and provider errors are not persisted as separate fields. Edit context omits existing configuration values and literal inputs, while locally preserving omitted fields on unchanged node types. Use synthetic prompts for live qualification. A provider-wide monetary cap and production data policy remain release requirements.

## 11. Identity, credentials, and security

- Integrate managed authentication rather than implementing password storage. Verify issuer, audience, signature, expiry, and workspace membership on the server.
- Start with owner/admin, editor, and viewer roles. Approval policies specify permitted reviewers; sensitive actions can require a reviewer other than the requester.
- Prefer a same-origin API and secure HTTP-only session cookies. Apply CSRF protection to state-changing cookie-authenticated requests and use restrictive CORS.
- Store platform API keys in the deployment secret manager. Store customer credentials using managed secret references or authenticated encryption with externally managed, rotatable keys. Never expose secret values through connection reads.
- For OAuth connectors, validate state, use PKCE where applicable, request limited scopes, refresh tokens safely, and support revocation. Never share one customer's tokens/profile with another.
- Verify webhook signatures before parsing business intent. Enforce payload limits, timestamp/replay checks where supported, and event deduplication.
- Treat workflow inputs, provider outputs, extracted page text, filenames, and URLs as untrusted. Render dynamic frontend text safely instead of inserting unescaped values into HTML templates.
- Restrict browser and HTTP destinations, redirects, protocols, and ports. Deny private, loopback, link-local, and cloud metadata destinations; account for DNS rebinding and subrequests. Prove network enforcement in the Steel integration spike; URL validation alone is insufficient.
- Restrict first-version browser workflows to reviewed domains/templates until required remote-browser network controls are proven.
- Redact authorization headers, cookies, passwords, and sensitive input/output fields. Disable or restrict recording for sensitive login flows; define who can view screenshots and recordings.
- Keep artifacts private with short-lived authorized downloads, bounded sizes, safe content disposition, and retention/deletion jobs.
- Recheck access on approval, file download, reconnect, retry, and run cancellation. Record connection changes, activations, approvals, and other sensitive actions in the audit trail.

## 12. Existing frontend changes

| Current surface | Backend integration |
| --- | --- |
| Overview | Load real counts, recent runs, failures, and usage |
| Scenarios/editor | Save drafts, configure triggers and connections, activate versions |
| Runs | Show real step state, outputs, artifacts, cancellation, and safe retries |
| Apps | Show implemented connectors and connection health |
| Team | Load authorized workspace membership and roles |
| Data | Show allowed variables and connection metadata; mask secrets |
| Settings | Persist timezone and workspace configuration |
| Billing | Initially show measured usage; payments/subscriptions are a later feature |
| Learn/help | Keep informational content separate from operational data |

Introduce a small shared API client for authentication/session handling, errors, and requests. Poll active run details at a bounded interval initially, stopping on terminal states and backing off in hidden tabs. Realtime streaming is optional later; if enabled, issue only narrowly scoped credentials. [Trigger.dev realtime authentication](https://trigger.dev/docs/realtime/auth)

Local drafts are not automatically uploaded. Provide an explicit import that validates them against the server schema; preserve the original local data until import succeeds. Existing simulated module names do not imply that those connectors are implemented.

## 13. Operational visibility and usage

Correlate our workspace/workflow/run/step IDs with Trigger run IDs and Steel session IDs. Record structured, redacted logs and error categories.

Track queue/dispatch delay, completion rate, step duration, retries, rejected events, approval expiry, browser minutes, orphan sessions, reconnect requirements, and artifact storage. Separate actual measured usage from estimated provider cost.

Use hard per-run time limits, workspace quotas, and a global concurrency cap. Start with one simultaneous browser session per connected account. Choose numerical limits after checking account capacity and timing the first workflow.

Reserve run quota atomically when accepting work so concurrent requests cannot bypass limits. Reconcile reservations against terminal outcomes and measured usage; admission checks alone are insufficient.

Alert on dispatch backlog, cleanup failures, unusual failures, and quota exhaustion. Reconcile final provider usage asynchronously when available. Do not present example prices from the landing page as actual backend billing.

## 14. Testing and acceptance criteria

### Automated tests

- Unit: workflow validation, reference resolution, condition evaluation, retry classification, state transitions, and redaction.
- API/database: role checks, cross-workspace isolation, optimistic draft updates, immutable versions, transactional dispatch, and duplicate manual requests.
- Events: invalid signatures, replayed/duplicate/out-of-order deliveries, disabled triggers, malformed and oversized payloads.
- Orchestration: Trigger submission succeeds but acknowledgement is lost, worker retries, duplicate worker starts, expired idempotency keys, and reconciler recovery.
- Browser: selectors/waits, expired login, file download, profile isolation, connection lease contention, session cleanup, and uncertain submission outcomes.
- Approval/cancellation: unauthorized/duplicate/late decisions, token-completion failure recovery, expiry, cancellation races, and browser cleanup after worker termination.
- Security: URL/redirect/DNS restrictions, secret exposure, private artifact access, unsafe rendered output, and revoked connections.

Use mocked providers and a controlled browser fixture for routine tests. Run a small opt-in staging test against real Trigger.dev and Steel with test accounts and bounded spending. Test destructive/submitting actions only against controlled targets.

Keep the existing frontend checks. Add type checks and relevant lint/build checks when the TypeScript backend exists; do not claim live provider success from mocks alone.

### First end-to-end acceptance test

1. Sign in and create a workspace.
2. Connect a controlled portal account.
3. Build and activate an invoice-download workflow.
4. Start it manually and observe real progress and a saved file.
5. Verify that the Steel session is released and artifacts are private.
6. Launch the same workflow from a schedule and a signed webhook.
7. Send the webhook twice and verify one business execution per event/workflow.
8. Exercise expired login, rejection/expiry, cancellation, and worker failure.
9. Confirm another workspace cannot read the connection, run, or file.

## 15. Development, deployment, and recovery

Suggested structure, created only as implementation needs it:

```text
server/
  src/                 HTTP routes, authorization, database queries, workflow validation
  migrations/          SQL migrations
  tests/               API and database integration tests
trigger/               Dispatch, workflow, schedule, cleanup and reconciliation tasks
shared/                Workflow/action definitions used by API and workers
app/                   Existing workspace frontend
```

Run the API locally alongside the current static frontend, using a development proxy or explicitly allowed development origin. Use isolated development/staging databases, Trigger environments, Steel projects or equivalent provider boundaries, credentials, and object-storage prefixes/buckets.

The [migrations](server/migrations/) create users, workspaces, memberships, workflow drafts, and stored versions. Before applying them, a database administrator provisions `runspell_runtime` as a dedicated `NOLOGIN`, `NOBYPASSRLS` role without administrative privileges or table ownership. Apply migrations as a separate schema owner. The API pool uses a dedicated database login that can assume the runtime role for workspace queries.

The Fastify app requires a trusted server-side identity resolver. The managed identity adapter will verify identity-provider tokens and map validated issuers and subjects to internal UUIDs through a separate, narrowly scoped lookup. The app sets the role and validated actor on the same transaction and connection used for workspace queries. Row-level security lets members read their workspaces and lets owners, admins, and editors write drafts. The runtime role cannot change memberships, move workflows between workspaces, or write stored versions.

Draft writes use the shared validator and an atomic revision check. Activation will require a separate server-controlled write path. `npm run test:db` exercises the migration, policies, and draft routes against disposable PostgreSQL.

Configuration includes database access, auth issuer/client settings, Trigger and Steel credentials, artifact-store settings, encryption key references, and runtime limits. Put only placeholder names in `.env.example`; validate configuration on startup and never log values.

CI runs relevant tests, type checks, and builds before release. Apply reviewed, compatible migrations; keep old workflow schema handlers available for versions still running. Back up PostgreSQL and verify restores. Treat provider recordings/profile retention separately from our database backups.

For recovery, restore authoritative database records, reconcile pending dispatch and external sessions, then resume safe work. Never bulk-replay uncertain external submissions. Support disabling new triggers while investigating incidents.

Deploy only after explicit authorization. This planning task does not authorize creating paid resources, enabling production webhooks, scheduling real jobs, or deployment.

## 16. Backend work and completion gates

The [roadmap](ROADMAP.md) tracks milestone status. These work items define backend acceptance evidence within M0 and M2–M5.

| Milestone | Deliverable | Completion gate |
| --- | --- | --- |
| M0 live provider spike | Test Trigger task connects to Steel, uses Playwright, releases browser; prove login/profile and viewer behavior | Observe actual provider execution, cleanup after failure, and required network/access controls |
| M2 backend foundation | API, managed identity integration, PostgreSQL migrations, workspace authorization, secret handling | Cross-workspace and role tests pass; no secrets returned or logged |
| M4 first browser workflow | Immutable definition, durable manual dispatch, one portal template, outputs/artifacts, run history | Invoice-download acceptance flow succeeds against a controlled account |
| M4 event and schedule support | Native/custom signed ingress, deduplication, dynamic schedules, overlap policy | Same workflow starts from manual/schedule/webhook paths without duplicate execution |
| M4–M5 operational controls | Approval decisions, safe retries, cancellation, quotas, cleanup and reconciliation | Fault-injection, concurrency, uncertain-outcome, and cleanup tests pass |
| M5 workspace integration | Replace sample data in relevant screens; import drafts explicitly | Frontend shows real authorized state and clearly labels simulations |
| M5 release preparation | Staging soak, alerts, retention, backup/restore, dependency/security review | End-to-end gates pass and documented deployment approval is obtained |

Apply security and validation from the first affected implementation. Do not enable automatic schedules or state-changing production actions before the relevant operational controls pass.

If multiple agents are used, assign exclusive file ownership: research for bounded provider questions, implementation for server/worker changes, docs-ui for separate frontend/documentation files, testing for tests, and review/security for read-only checks before fixes. Parallelize only independent work and respect the session's concurrency limit.

## 17. Decisions needed before implementation

1. First website and exact task, including the expected output and whether any action changes external data.
2. First event provider and how it authenticates/delivers events.
3. Identity, PostgreSQL, storage, API hosting providers, and deployment region.
4. Expected users, concurrent browsers, run frequency, and acceptable monthly spend.
5. Initial retention requirements and who may approve/view sensitive runs.

The default first task is a controlled invoice-download flow. These choices refine scope; they do not require changing the shared workflow architecture.

## 18. Deferred scope and known risks

Constrained natural-language authoring is part of M3. Run recovery uses configured selector fallbacks, bounded retries, credential reconnection, and manual reconciliation. Trigger.dev remains the single workflow engine.

Defer a universal connector marketplace, full browser recording/replay authoring, isolated code transforms, bounded loops, payment subscriptions, and enterprise administration until a concrete requirement justifies them.

Known risks: website changes, expired logins/MFA, external throttling, ambiguous browser submissions, provider outages, remote-session cost, and sensitive artifacts. Mitigate them through explicit templates, revalidation, bounded execution, reconciliation, access controls, and human review where results are uncertain.

Pricing, account-specific concurrency/session limits, data-residency commitments, viewer access behavior, and remote-browser network enforcement require verification in the M0 live spike. No live provider integration, credentials, production action, or deployment has been tested as part of this document.

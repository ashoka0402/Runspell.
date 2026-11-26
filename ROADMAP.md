# Runspell product and engineering roadmap

Updated 26 November 2026. The Runspell rebrand, M0 offline work, and the M1 prototype are verified locally. M2–M5 are in progress. The M0 live provider gate remains pending.

## 1. Purpose and source documents

Runspell uses AI to turn a business request into an editable workflow. Users connect authorized accounts, test the workflow, and explicitly activate an immutable version. The execution engine performs deterministic browser and API actions and records verifiable outcomes.

**Intelligence designs. Runspell executes.**

The [revised product direction](additional.md) governs scope. This roadmap sets delivery order, launch scope, and progress. The companion files retain detailed requirements.

- [Backend implementation plan](BACKEND_PLAN.md): execution architecture, data model, APIs, security, and operational controls.
- [Product expansion addendum](Relay_Expansion_Addendum_2026-11-19.md): prompt-first authoring, animated graph editing, evidence, recovery, and subsequent expansion.

The existing integrated landing page and workspace are the starting frontend. They currently use sample data and browser-local drafts. They do not constitute a working backend or live automation system.

## 2. Decisions carried forward

| Area | Direction |
| --- | --- |
| Integration preference | Official APIs for supported actions; webhooks for available events; browser actions when the required API capability is unavailable |
| Workflow model | One engine with manual, scheduled, and event starts; a workflow may have multiple trigger bindings; each run has one initiating source |
| Backend | TypeScript/Fastify, PostgreSQL, Clerk or the existing managed identity provider, and private object storage |
| Frontend | Keep the static shell and isolated React/TypeScript editor. Evaluate Next.js when a product requirement justifies migration |
| Optional integrations | Assess Stagehand for bounded browser actions, Resend for email, Liveblocks for collaboration, and Framer Motion for unmet motion requirements |
| Execution | Trigger.dev orchestrates; Steel provides browsers; Playwright controls supported browser actions |
| AI | Gemini first via a provider-neutral interface. AI authors candidate plans and proposes edits; deterministic validation and policy checks control execution |
| Canvas | Isolated React Flow editor with GSAP motion, subject to compatibility proof; preserve the surrounding frontend |
| Truth | Immutable workflow versions and server records; animation reflects accepted draft changes |
| Delivery | One repository, bounded modules, no second queue or workflow engine |

An absent API key does not automatically imply browser execution: OAuth or another supported API authentication method may be available. Switching execution methods is an explicit, reviewable workflow change.

## 3. First-release boundary

### Required for launch

- Prompt Studio using one model provider and a small registry of supported actions.
- Animated, editable graph; conversational edits shown as reviewable diffs.
- Visible assumptions, missing connections, unsupported requests, and action permissions.
- Persistent drafts, explicit activation, immutable versions, and recoverable draft-event streaming.
- Workspace authentication, roles, isolated connections, protected secrets, and private artifacts.
- One selected portal, one selected API/event integration, sequential execution, simple conditions, and basic approvals.
- Manual, scheduled, and signed-webhook starts for the same workflow engine.
- Distinguish schema validation, mock execution, read-only live execution, controlled write tests, and production execution. Show actions and permissions before testing and results before activation.
- Flight Recorder timeline and factual execution receipt.
- Manual failure resolution with authorized evidence, credential reconnection, configured selector fallbacks, and human reconciliation for uncertain writes.
- Bounded retries, event deduplication, cancellation, connection exclusivity, quotas, session cleanup, and operational alerts.

### Launch demonstration

A user requests a workflow to collect one known invoice from an authorized portal, read available structured fields, request approval when a validated amount exceeds a threshold, save the invoice, and deliver a result through the selected API integration.

The user reviews the generated graph and connections, runs a controlled test, and explicitly activates it. Demonstrate manual, scheduled, and webhook starts, plus a failure/reconnect path and an execution receipt. The browser is opened only when its actions need it.

This example does not depend on batch loops or PDF/OCR extraction. Those capabilities arrive in later milestones. The exact portal, integration, fields, and approval rule must be selected before live execution work.

## 4. Milestone sequence

| Milestone | Deliverable | Dependencies | Exit gate |
| --- | --- | --- | --- |
| M0 | Contracts and feasibility | Source plans | Supported schemas and draft-event contract validated; canvas/provider risks documented |
| M1 | Authoring prototype | M0 contracts | Mocked prompt produces an editable graph; refresh/replay preserves it; no execution implied |
| M2 | Backend foundation | M0 offline contracts and backend provider decisions | Authorized drafts, versions, connections, run records, and durable dispatch pass isolation tests |
| M3 | Real AI authoring | M1, M2, model selection | Constrained generation and revisions pass the representative prompt suite; persisted stream recovers |
| M4 | Working execution slice | M2, provider feasibility | One real workflow completes with private artifacts, basic approval, cleanup, and safe manual/event/schedule starts |
| M5 | Launch reliability and release readiness | M3, M4 | Integrated prompt-to-execution acceptance suite, test modes, evidence, manual recovery, and security gates pass |
| M6 | Useful integrations and data work | M5 and demonstrated demand | Selected connectors, human tasks, and document features pass their dedicated gates |
| M7 | Recording and reuse | M5 and stable action contracts | Consented recording becomes a tested draft; components remain version-pinned |
| M8 | Advanced workflow and extension platform | Stable M6/M7 capabilities as applicable | Bounded logic, tables, sandbox/MCP controls pass feature-specific isolation and quota tests |
| M9 | Business and enterprise operations | Customer requirements and stable core | Governance, release promotion, business queues, and policy gates pass |

M1 and the independent parts of M2 can progress in parallel after the shared contracts are settled. M3 and M4 can progress independently against the same accepted contracts. M5 integrates both. Later milestones are a roadmap, not first-release commitments.

### M0 — Contracts and feasibility

**Work**

- Define versioned node manifests: input/output schemas, connection scopes, runtime, side effects, budgets, retry safety, and evidence requirements.
- Define the canonical workflow representation and compiler checks; preserve historical schema handlers for activated versions.
- Define draft revision rules, AI patch acceptance, generation states, ordered SSE events, event IDs, replay cursors, and snapshot recovery.
- Define run/evidence terminology, approval decisions, cancellation, unknown outcomes, and the four test modes.
- Prove an isolated React Flow/GSAP editor can mount and unmount inside the current app without breaking routing, keyboard behavior, styling, or local drafts.
- With authorized test credentials and a spending limit, prove Trigger.dev → Steel → Playwright, login/profile persistence, session release, viewer access, network restrictions, and failure cleanup.

**Gate**

A fixture-generated plan validates and reconstructs from an event stream. Compatibility evidence and provider-spike results are recorded separately; a mocked result cannot satisfy the live provider gate. Work that does not require provider access may continue while that gate is pending.

### M1 — Prompt Studio and graph prototype

**Work**

- Add prompt entry, clarification/assumption display, plan preview, missing-connection states, and an editable graph.
- Animate real accepted fixture/draft operations, with reduced-motion support and keyboard-accessible alternatives.
- Support manual edits and AI-proposed patches with a visible before/after diff and revision-conflict handling.
- Preserve the existing workspace shell, landing page, and explicit local-draft import path.
- Label fixtures, previews, and simulated runs clearly. The prototype cannot start external actions.

**Gate**

Repeated edits, cancelled generation, navigation away/back, refresh, duplicate events, missed events, and reconnect reconstruct the same draft without duplicate nodes or lost accepted changes. Interrupted generation remains editable and has an honest status.

### M2 — Backend foundation

**Work**

- Add the API, SQL migrations, managed identity integration, workspace roles, and boundary validation.
- Implement persistent drafts/revisions, immutable versions, connection references, secret handling, and private artifacts.
- Add generation/event storage and the action registry interfaces needed by M3.
- Add run/step records, transactional dispatch outbox, idempotency, audit events, and quota reservations.
- Expose authorized APIs to the existing frontend; replace sample data only where the real feature exists.

**Gate**

Cross-workspace access fails for workflows, generations, credentials, runs, and artifacts. Stale draft changes are rejected; activated versions remain unchanged; duplicate run requests and interrupted dispatch recover safely. Secrets do not appear in model inputs, API responses, logs, or rendered HTML.

### M3 — Real AI generation and conversational revision

**Work**

- Implement a Gemini adapter behind a small provider-neutral interface; configure allowed model, token/cost limits, and data minimization.
- Give the planner only authorized registry metadata and sanitized inputs.
- Generate typed candidate plans, validate/compile them, and persist accepted draft revisions and ordered events.
- Keep unaccepted revision proposals separate until reviewed. Direct generation creates an inert draft, never an active workflow.
- Reject unsupported actions and invalid references; ask for genuinely blocking missing information instead of inventing capabilities.
- Enforce authenticated generation streams, reconnect cursors, budget reservations, and usage attribution.

**Gate**

At least 20 representative prompts produce either valid editable drafts or clear unsupported/clarification outcomes. Include revisions, missing connectors, malicious retrieved content, invalid schemas, budget exhaustion, concurrent edits, and stream interruption. No test may activate or run a workflow without the required explicit action.

### M4 — Real execution across browser, API, and triggers

**Work**

- Implement the selected portal template and selected API integration with typed input/output mappings.
- Execute version-pinned actions in Trigger.dev; use Steel only for browser work.
- Add browser login verification, exclusive connection leases, hard/inactivity limits, cleanup, and orphan reconciliation before real runs.
- Add safe retries, external-operation identifiers, outcome verification, cancellation, and basic durable approval with expiry.
- Complete manual execution first, then signed, deduplicated webhooks and supported application events and timezone-aware schedules with overlap rules.
- Reconstruct read-only browser prerequisites after waits or replacement sessions; revalidate before any write.

**Gate**

The chosen workflow succeeds against controlled accounts through all three starting paths. Duplicate events cause one logical execution; ambiguous writes stop in `needs_attention`; expiry/rejection prevents the gated action. Worker termination and cancellation do not leave an unbounded session running.

### M5 — Reliability and launch readiness

**Work**

- Integrate M3 authoring with M4 execution and replace relevant workspace simulations with real state.
- Provide redacted step timelines, attempt metadata, external identifiers, private artifacts, model usage, and measured browser usage.
- Generate execution receipts that distinguish task completion, observed external-state verification, and unknown outcomes.
- Provide reconnection and manual resolution from recorded evidence. A user can edit and validate a draft, then explicitly activate a new version. Keep run retries and new executions distinct.
- Present test modes, action/permission previews, budget limits, and activation controls honestly.
- Complete alerts, retention/deletion, backup/restore, staging checks, operational recovery instructions, and dependency/security review.
- Complete a Runspell name review before public launch.

**Gate**

A signed-in user can complete prompt → validated graph → reviewed edit → connections → controlled test → explicit activation → real run → receipt. Refresh/reconnect, expired login, failed selector, duplicate event, uncertain submission, exhausted budget, late approval, and worker failure all have tested outcomes. No state-changing production trigger is enabled before these controls pass.

Deployment requires separate explicit authorization. Passing this milestone makes the product ready for that decision; it does not authorize publication.

## 5. Expansion after the first release

| Milestone | Scope | Acceptance focus |
| --- | --- | --- |
| M6a: Connectors and human tasks | Demand-led Gmail/Sheets/Slack or Outlook/Teams plus the selected business system; forms, edited-output review, reminders, reassignment, escalation, durable callbacks; richer operations views | OAuth scopes, rate limits, typed mappings, duplicate/late responses, rejection/expiry, no idle browser during long waits |
| M6b: AI and documents | Schema-bound AI processing, PDF/OCR extraction, evidence-backed fields, file utilities | Fixture accuracy, provenance, low-confidence review, prompt-injection handling, file controls, bounded costs |
| M7: Recording and reuse | Consented browser recorder, replay editor, versioned subworkflows, private templates and sharing | No password/MFA/token capture; editable stable locators; reviewed replay; bounded nesting; pinned dependencies |
| M8a: Workflow/data extensions | Bounded loops, parallel branches/joins, workspace tables, controlled research/extraction | Defined limits, compiler validation, cross-branch references, cancellation, provenance, quotas and access isolation |
| M8b: Extension platform | Separately isolated opt-in code transforms, explicitly published authenticated MCP tools, curated connector SDK | Sandbox escape/network/secret controls; per-tool authorization, confirmation, quotas, audit and revocation |
| M9: Business/enterprise | Business work queues and SLAs, governance/DLP, audit exports, environment promotion/rollback, demanded suite/ERP integrations, optional SSO/SCIM | Tenant policies, environment credentials, release gates, rollback and queue ownership |

Prioritize expansion by demonstrated demand after M5. The experimental concepts in [additional.md](additional.md) require explicit approval before entering committed milestones.

## 6. Dependency and scope rules

- Settle shared schemas before independent UI, API, or worker implementations rely on them.
- Mocked authoring prototypes can precede credentials and hosting choices. Real persistence, model calls, execution, or deployment waits for its actual prerequisites.
- No whole-frontend migration, second workflow engine, universal connector marketplace, autonomous-browser default, or arbitrary user-code execution in the launch scope.
- Graph positions and animations never become executable truth. AI output passes the same schema, permission, domain, budget, and activation checks as manual edits.
- Browser/API side effects, prompt privacy, workspace isolation, and session cleanup are built into the first affected feature. They are not postponed until a final security phase.
- Preserve provider-independent action contracts, explicit schema versions, stable operation IDs, and compatibility for in-flight runs.
- Choose numeric budgets and retention periods from account limits and measured workflow behavior; do not invent capacity or completion dates.
- Every milestone closes with actual test results, unresolved issues, and an updated status. A working demo does not close a production-readiness gate.

## 7. Decisions and blockers

| Decision | Needed by | Work that can proceed meanwhile |
| --- | --- | --- |
| First portal, one exact task, expected result, read/write boundaries | M0 live spike and M4 | Schemas, mocked canvas, API boundaries |
| First API/event integration and account permissions | M4 | Generic trigger/action contracts and fixtures |
| Gemini model, data policy, and usage limits | M3 | Fixture generation, adapter interface, compiler and canvas |
| Identity, database, object storage, API host and region | M2 service integration; deployment later | Data model, local tests, authorization contract |
| Provider access and permitted test spend | Live M0 spike, M3/M4 | All clearly labelled offline/mocked checks |
| Expected concurrency, frequency, retention, reviewers and budget | Live testing and M5 | Configurable bounded policies with conservative test defaults |
| Runspell name review | Public launch | Private development and controlled testing |

No credentials or vendor accounts have been configured by creating this roadmap. An unanswered decision blocks only the work that depends on it.

## 8. Engineering workflow and verification

Use bounded ownership when delegation helps: research investigates a specific provider/compatibility question; docs-ui owns selected frontend/documentation files; implementation owns server/worker files; testing owns checks; review/security inspect completed slices. Prefer two or three active agents and respect the available session limit. No overlapping file edits; downstream work waits for its dependencies.

For each implemented slice:

1. Confirm the relevant contract and source requirements.
2. Make the smallest complete change, including callers and data migrations.
3. Run meaningful unit/integration checks, type/lint/build checks where available, and targeted browser checks for UI behavior.
4. Inspect authorization, secret handling, external side effects, idempotency and cleanup relevant to that slice.
5. Fix confirmed failures and report evidence, skipped checks, remaining risks, and milestone status.

### Progress and evidence

| Work | Status | Evidence |
| --- | --- | --- |
| Static preview | Implemented | Landing page and workspace with simulated runs and browser-local drafts |
| M0 offline contracts and canvas | Verified | Shared workflow schemas, action registry, invoice fixture, event replay, and isolated React Flow/GSAP lab. See [M0 evidence](docs/M0.md) |
| M0 live feasibility | Pending authorization | A live Trigger.dev, Steel, and Playwright spike must verify login, session cleanup, viewer access, network controls, and usage |
| M1 offline authoring | Verified | Fixture-based Prompt Studio with editable nodes, reviewed mock revisions, validation, explicit import, interruption recovery, and browser-local persistence. See [M1 evidence](docs/M1.md) |
| Runspell rebrand | Verified locally | Landing and workspace branding, page metadata, and package metadata use Runspell. Existing routes, animations, and local draft keys are retained |
| M2 workspace and workflow schema | Verified locally | PostgreSQL 18 migration covers identities, memberships, draft storage, version records, and workspace access policies. See the [backend plan](BACKEND_PLAN.md#15-development-deployment-and-recovery) |
| M2 Fastify draft API | Verified locally | PostgreSQL-backed list, create, read, and revision-checked replacement routes use shared validation and workspace policies. HTTP tests inject verified identities |
| M3 planning API and Gemini adapter | Implemented locally | Inactive drafts, reviewable revision proposals, durable outcomes, scoped event replay, and workspace quotas. Live Gemini and browser integration remain pending |
| M4 local manual mock execution | Implemented locally | Explicit activation, immutable version pinning, idempotent acceptance, transactional outbox dispatch, and receipts built from simulated steps |
| M5 Flight Recorder for mock runs | Implemented locally | Authorized timelines and JSON receipts preserve the pinned version and identify simulated outcomes. The workspace preview opens receipt files locally |
| M2 identity and M5 run-history APIs | Implemented locally | Configured OIDC token verification, isolated identity lookup, membership discovery, and workspace-scoped run pagination |
| Remaining M2 and M4–M9 | Planned | Hosted sign-in setup, live activation, connection storage, provider execution, schedules, webhook starts, and launch readiness |

Local backend verification on 26 November 2026 passed type checking, 35 TypeScript unit tests, PostgreSQL integration for mock execution and signed-identity run history, and a loopback API startup check. The latest frontend verification passed 4 Python checks, 10 Playwright tests, and the build with upstream React Flow and React compiler directive warnings. The live provider gate remains pending.

## 9. Next work

1. Configure the selected managed identity provider and implement connection storage and live workflow activation.
2. Resume the M0 live spike after approval of the portal, test accounts, and spending limit. Record actual session, cleanup, access, and usage results before closing feasibility.
3. Qualify M3 with a live synthetic Gemini check and the representative prompt suite. Connect Prompt Studio to authenticated API events and verify recovery when the original generation response is interrupted.
4. Continue M4 with live execution prerequisites and verify the chosen portal and API integration after the live provider gate.
5. Continue M5 by connecting Flight Recorder to authorized run history and verifying the complete prompt-to-receipt flow, controlled tests, and manual failure resolution. Public deployment requires separate authorization.

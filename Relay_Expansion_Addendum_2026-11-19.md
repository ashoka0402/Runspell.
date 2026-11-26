# Runspell — Product Expansion Addendum

Updated 26 November 2026. This companion details product features. The [roadmap](ROADMAP.md) sets delivery order and progress, and [additional.md](additional.md) governs scope.

The [backend plan](BACKEND_PLAN.md) defines execution, authorization, and storage. Runspell uses one version-pinned workflow engine with explicit approvals, bounded retries, and documented outcomes.

## 1. Product direction

**Positioning:** Prompt-first, API-first, browser-capable business automation with observable, recoverable execution.

**Signature experience:** A user describes an outcome; Runspell proposes a valid graph, visibly assembles it on the canvas, identifies needed connections/permissions, runs a controlled test, and activates only after explicit approval. The animation must reflect real validated draft changes, never a fabricated execution.

**Initial buyer:** Operations teams and agencies that repeat work across SaaS APIs and portals where APIs are missing or insufficient.

**Product principle:** AI **authors and recommends**; a deterministic, policy-checked engine **executes**. An agent cannot bypass authorization, budgets, or approval gates.

## 2. New feature catalog

### A. Prompt-first building and intelligent authoring — P0/P1

1. **Conversational workflow generation (P0).** Natural-language prompt → requirement extraction → structured plan → typed, editable graph. Ask only for blocking missing details; mark assumptions prominently. Never invent a connector, credential, or successful action.
2. **Live canvas construction (P0).** Stream real build milestones (understanding, planning, nodes validated, nodes added, connections needed, ready to test). Animate node placement, edges, auto-layout and viewport focus using the current frontend where possible; adopt React Flow (`@xyflow/react`) for a dedicated graph canvas, with GSAP for motion. Version-pin and test compatibility with the existing app before integrating.
3. **Conversational revisions (P0).** “Add an approval before sending,” “switch the trigger to Monday,” or “use the browser instead of an API” produces a reviewable diff. Apply to the draft only; never silently mutate an active version.
4. **AI configuration assistant (P1).** Recommend node parameters, field mappings, expressions, selectors, timeouts and test inputs, with confidence or warnings. Prefer stable semantic locators.
5. **AI action nodes (P1).** Summarize, extract, classify, translate, generate, evaluate and structured-output actions. Require output schemas, input provenance and optional human review; never treat retrieved text as instructions to the workflow engine.

### B. Demonstrate, capture and reuse — P1/P2

6. **Browser task recorder (P1).** Explicit recording of permitted clicks, navigation, form filling and extraction within an authorized browser session; convert into suggested Playwright steps. Prefer selectors and typed fields over raw coordinates. Review recording before saving; automatically exclude passwords, cookies, session tokens and sensitive fields. The recorder is not an authorization bypass.
7. **Replay editor (P1).** Inspect each captured step, test against a controlled account, replace brittle selectors and add validation assertions. UI should show which steps are stable, incomplete or require a human.
8. **Reusable subworkflows (P2).** Versioned, typed components with declared inputs/outputs, dependencies and permissions. Nested execution is bounded; changes to a shared component do not rewrite previously activated versions.
9. **Templates and sharing (P2).** Curated, tested workflow templates with explicit permissions, sample inputs, test-mode limitations and connector requirements. Workspace-private sharing first; a public catalog later.

### C. Rich workflow logic and human decisioning — P1/P2

10. **Enhanced human tasks (P1).** Extend basic approvals to: approve/reject, edit AI output, collect missing information, perform a manual task, or select a branch. Support assignees, validated forms, deadlines, reminders, reassignment, escalation, decision history and separation of duties.
11. **Dynamic waits (P1).** Wait for a date, duration, validated external callback or approved human response. Store waiting state durably; do not keep a browser session alive during long waits. Resume with revalidation.
12. **Bounded loops and parallel branches (P2).** `for_each`, typed condition paths and join behavior with explicit limits on items, depth, concurrency and total cost. No unrestricted cycles or arbitrary program graphs.
13. **Built-in workspace tables (P2).** Lightweight typed record storage to power lookups, deduplication, stateful workflows and internal forms, with access control, row quotas and audit history. This is not a general SQL console.
14. **Work queues (P3).** Distinct from the underlying Trigger.dev task queue: business items with priorities, assignees, SLAs, retry policies, dead-letter review and dashboards. Example: invoice exceptions awaiting human resolution.

### D. More useful integrations and intelligent data work — P1/P2

15. **Curated connector library (P1).** First add Gmail, Google Sheets, Slack, Outlook/Teams where demanded, and one business system relevant to the launch workflow. Each connector gets discoverable triggers/actions, OAuth scopes, rate limits, error mapping, test fixtures and versioned schemas. Expand based on demand rather than claiming hundreds of superficial connectors.
16. **Document intelligence (P1).** Ingest PDFs, receipts, invoices and CSVs; OCR when required; extract to validated structured schemas; return page/field evidence and uncertainty flags. Route low-confidence or high-impact results to human review.
17. **File and data utilities (P1).** CSV/JSON mapping, date/time functions, PDF splitting/merging and safe file conversion, within size and malware-scanning policies.
18. **Research and scraping nodes (P2).** Controlled browsing and extraction from permitted sources, with source provenance, rate limits, robots/terms considerations and prompt-injection safeguards. Don't treat scraped content as trusted instructions.
19. **Sandboxed custom code (P2).** Optional JS transformation step in a separately isolated execution service with CPU/memory/time limits, no secret access by default, no network access unless approved and explicit package allowlists. Do **not** use `eval` or Node's `vm` as a security boundary. Off by default.
20. **MCP tool publishing (P2).** Expose explicitly approved, versioned workflows as authenticated tools to external AI assistants, with workspace scopes, input schemas, audit logs, per-tool quotas, explicit confirmation for state-changing actions and revocation.

### E. Reliability as a visible product feature — P0/P1

21. **Runspell Flight Recorder (P0).** Per-run event timeline with node state, input/output previews (redacted), attempt metadata, selector/HTTP diagnostics, optional masked screenshots, artifacts, approvals, model usage and external identifiers. Generate a downloadable *execution receipt* stating observed facts only; do not assert business completion merely because the task returned success.
22. **Dry-run and controlled test mode (P0/P1).** Distinguish schema validation, mock execution, read-only live execution, controlled write tests, and production execution. Provide explicit pre-run preview of actions and permissions. A dry-run must never be labelled as an actual external success.
23. **Automation Operations Center (P1).** Cross-workflow failures, bottlenecks, queue depth, approval wait time, browser minutes, agent/model spend, retry frequency, external-side-effect uncertainty, reconnect needs and per-workspace budgets. Alerts and actionable run filtering.
24. **Business outcome checks (P1).** After an external write, verify the resulting state where possible and link evidence to the action. If an outcome remains unknown, stop instead of blindly retrying.

### F. Enterprise operations — P3

25. **Organization governance (P3).** Workspace/org roles, granular connector and domain policies, audit exports, retention policies, model allowlists, DLP rules, environment-specific credentials, admin approval policies, and eventually SAML SSO/SCIM if customers require them.
26. **Release pipelines (P3).** Promote immutable workflow versions from development to staging to production with environment-bound connections, test gates, change review, rollback to a previously valid version and change history.
27. **Deep productivity-suite integrations (P3).** Team approvals in Teams/Outlook/Slack, SharePoint/Dataverse/ERP integrations and enterprise identity policies where customer demand warrants.

## 3. Additive system architecture

The original API, database, Trigger.dev worker, Steel/Playwright browser path and storage remain authoritative. Add modules inside the same repository first; split into services only for isolation or scale.

**Client additions**
- **Prompt Studio:** conversational requests, clarification questions, plan preview and safe diff acceptance.
- **Animated Graph Canvas:** visual projection of validated draft events; drag-editable nodes, edges, branches and reusable components. Canvas geometry is never executable source of truth.
- **Workflow testing and run review:** action and permission preview, live step status, masked evidence, approval forms, credential reconnection, and manual resolution.
- **Operations Center:** run receipts, alerts, costs and queue/approval status.

**API/backend modules**
- **AI Planning Gateway:** provider abstraction, model routing, structured-output validation, usage budgets, prompt/version history and redaction; receives only authorized connector metadata, not raw credentials.
- **Node & Connector Registry:** versioned manifests describing action types, input/output JSON Schemas, OAuth scopes, idempotency class, supported runtime, limits and UI forms.
- **Graph Compiler:** canonical, provider-independent intermediate representation; resolves references, verifies policy/permissions, checks branches/loops and emits the existing immutable workflow format plus explicitly versioned extensions.
- **Draft Event Projector:** persists accepted draft changes and emits ordered `plan.*` / `draft.*` events through SSE. Animations are a rendering of persisted operations, not AI guesses about layout or progress.
- **Recording Adapter:** consented collection of allowed interactions in an authorized browser environment; sanitization, selector inference, action mapping and replay tests.
- **Human Tasks:** extends the existing approval model with forms, deadlines, escalations; coordinates with Trigger.dev waitpoints and database truth.
- **Evidence & Cost Ledger:** stores structured run evidence, receipts, model/token metrics and billable browser usage, respecting retention and access policies.
- **Document Extraction Adapter:** text/OCR pipeline, structured extraction, validation, source-page evidence and confidence checks; can be implemented as an isolated background worker.
- **Optional future modules:** sandboxed JS execution, MCP publication gateway, business work queues and enterprise policies.

**Execution contract**
1. User prompt enters the AI gateway; planner chooses only registry-listed capabilities.
2. Gateway produces a typed **candidate plan**, not executable code.
3. Server validates, compiles and commits an editable draft revision; it publishes durable, sequenced draft events.
4. UI renders node/edge creation and re-layout from committed events, with real connection and permission statuses.
5. User edits the draft or asks AI for a diff; activation still requires normal server checks and explicit action.
6. The existing version-pinned Trigger.dev workflow engine executes the approved version; Steel runs only browser steps.
7. Human tasks and uncertain outcomes suspend or stop safely; evidence and cost metrics remain accessible through authorized APIs.

**Suggested canvas event envelope**

```json
{
  "generationId": "uuid",
  "draftRevision": 12,
  "sequence": 38,
  "type": "draft.node_added",
  "payload": { "nodeId": "download_invoice", "actionType": "browser.download" }
}
```

Events may include `plan.started`, `plan.needs_clarification`, `draft.node_added`, `draft.edge_added`, `draft.node_configured`, `draft.connection_required`, `draft.validation_warning`, `plan.ready`, and `plan.failed`. Each event has stable IDs and a monotonic per-generation sequence. Reconnect via SSE `Last-Event-ID` or a cursor, then fetch the authoritative draft revision to correct missed events. Layout positions are frontend concerns. A generated workflow must remain editable if the stream is interrupted.

**Workflow language v2 extensions**
- New typed nodes: `ai.structured_output`, `document.extract`, `human.form`, `human.review_output`, `wait.event`, `loop.for_each`, `subworkflow.invoke`, `table.lookup/upsert`, `queue.enqueue`, `code.transform` (gated), `mcp.expose` (publishing metadata).
- Every node declares supported runtime, side-effect class (`read_only`, `idempotent_write`, `unsafe_write`), required scopes, input/output schema, cost/time budget, retry/recovery policy and evidence policy.
- Validation forbids unbounded loops, unresolved branches, incompatible outputs, unapproved destinations and cycles outside explicit structured loop nodes. Browser-side-effect steps remain conservative.
- Version migrations are explicit; existing active workflow definitions continue to run with their historical schema.

## 4. Additional storage design

Add only alongside the phase that consumes the table:

| Table or extension | Purpose |
|---|---|
| `ai_generations`, `ai_generation_events` | Prompts (redacted), model/config versions, generation state, ordered durable canvas updates |
| `node_catalog_versions`, `connector_manifests` | Allowed actions, JSON schemas, scopes, availability and version compatibility |
| `workflow_draft_revisions`, `workflow_components` | AI/user edits, diffs, reusable typed subworkflows |
| `browser_recordings`, `recording_steps` | Consent, sanitized captured actions, suggested locators and recording retention |
| `human_tasks` / extend `approvals` | Typed forms, assignee, due date, reminders, escalation, reviewer outcomes |
| `run_evidence`, `execution_receipts` | Evidence metadata, redacted event references and verified outcome records; large files in private object storage |
| `model_usage`, `usage_ledger` | Provider/model, token counts, per-operation cost attribution and usage caps |
| `workspace_tables`, `workspace_table_rows` | Typed internal records, access checks, bounded row count and versioning |
| `work_queue_items`, `queue_assignments` | Business queue ownership, priority, SLA and exception state (later) |
| `organization_policies`, `deployment_releases` | Governance, DLP, promotion/rollback review (later) |

Apply workspace/org referential constraints, indexes and retention to these tables. Do not store auth tokens, raw browser passwords or unnecessary sensitive prompts in generation records.

## 5. New API additions

All routes are illustrative and subject to the original `/api/v1` authentication, workspace checks, validation, rate limits and response conventions.

| Route suffix (under `/workspaces/:wid`) | Purpose |
|---|---|
| `POST /ai/generations` | Create a prompt-based candidate plan/draft generation |
| `GET /ai/generations/:gid` | Generation status, warnings and produced draft revision |
| `GET /ai/generations/:gid/events` | Replayable authorized SSE event stream |
| `POST /workflows/:id/draft/ai-edit` | Request a proposed patch, without activating |
| `POST /workflows/:id/draft/apply-patch` | Validate/revision-check and commit reviewed changes |
| `GET /node-catalog` | Supported triggers/actions, schemas, connection requirements |
| `POST /recordings` / `POST /recordings/:rid/finish` | Start/stop consented browser recording |
| `POST /recordings/:rid/convert` | Generate draft actions from sanitized recording |
| `GET /runs/:id/evidence` / `GET /runs/:id/receipt` | Authorized trace and factual execution receipt |
| `POST /human-tasks/:id/complete` | Validate data entry, edited output or choice and resolve once |
| `GET/POST /components` | Manage versioned reusable workflow components |
| `GET/POST /tables` and row-scoped routes | Manage typed workspace data (later) |
| `GET /operations/summary` | Usage, failures, approval backlog and costs |
| `GET/POST /work-queues` | Business work items and SLA policies (later) |

Provide a separately authenticated MCP gateway in its own namespace when enabled; never expose every workflow or API route automatically. Recording and browser sign-in viewer endpoints must use short-lived, one-purpose capabilities and log access.

## 6. Security and trust additions

- **Prompt safety:** Treat prompts, model output, web pages, extracted documents and connector data as untrusted. Use structured output and registry allowlists; never execute AI-generated scripts directly.
- **No stealth activation:** Generated drafts are inert until explicitly activated. Show precisely which external actions can read, write, publish, delete or spend money.
- **Sensitive action gates:** Payment, deletion, messaging, uploads and irreversible operations require stronger controls and/or approval. Never retry an ambiguous write merely because an AI suggests it.
- **Model privacy:** Mask secrets and minimize personal data before model calls; enforce workspace model/provider policies, retention and consent. Defend against prompt injection in scraped or retrieved content.
- **Recording privacy:** User-visible indicator, explicit start/stop, approved domains, never capture passwords or MFA, sanitize events and screenshots, encrypt artifacts, enforce short retention.
- **Code isolation.** Isolate future sandboxed transformations from browser profiles, secrets, and outbound networking by default.
- **Evidence integrity:** Link factual receipts to run/version, recorded identifiers and private artifacts. Distinguish observed completion, external-state verification and unknown outcome.

## 7. Milestone alignment

See the [roadmap](ROADMAP.md#4-milestone-sequence) for milestones and completion gates. Offline authoring is M1, Gemini integration is M3, live execution is M4, and Flight Recorder and launch readiness are M5. Select expansion work from M6–M9 based on demonstrated demand.

## 8. New acceptance scenarios

1. **Prompt → graph:** “Every morning collect vendor invoices, extract totals and notify me if a value changes” creates a catalog-valid draft with explicit connection needs; nodes animate as persisted operations are received.
2. **AI edit → audited diff:** “Insert approval when total exceeds ₹50,000” proposes a conditional and human step; the user sees and approves the change; the activated version remains immutable.
3. **Recording → safe action list:** A user records a controlled portal task; passwords and MFA inputs are omitted; the resulting draft has editable selectors and runs only with an authorized connection.
4. **Document validation:** A sample invoice yields structured fields with source evidence; malformed/low-confidence data routes to review instead of silently continuing.
5. **Manual failure resolution.** A selector fails after configured fallbacks. Runspell records the evidence. An authorized user edits and validates a draft before explicitly activating a new version.
6. **Uncertain external write:** A timeout occurs after submitting a form; Runspell does not submit again automatically and reports `needs_attention` until reconciled.
7. **Durable approval:** A human task expires, escalates or is rejected; durable waiting does not leak a live browser or allow duplicate completion.
8. **Tenant/model isolation:** One workspace cannot inspect another's prompts, recordings, connector metadata, traces, AI usage or browser sessions.
9. **Cost control:** A prompt specifying many browser actions or AI calls is rejected or constrained by budgets; measured usage stays separate from projections.
10. **Offline/reconnect canvas:** The UI reloads mid-animation; server-side draft and ordered events reconstruct the same graph without duplicate nodes.

## 9. Non-goals and decisions to preserve

- Do not replace Trigger.dev with a second durable workflow engine.
- Do not migrate the whole frontend just to add a graph canvas.
- Execute only registered, configured browser and API actions from the approved workflow version.
- Do not turn early connector work into a marketplace before two real customer workflows succeed.
- Record verifiable outcomes and send uncertain external writes for manual reconciliation.
- Do not treat an animated graph as proof that a workflow executed.
- Complete the Runspell name review before public launch.

## 10. Reference docs for implementation checks

- React Flow graph and layout: https://reactflow.dev/learn/concepts/building-a-flow and https://reactflow.dev/learn/layouting/layouting
- Trigger.dev durable human waits and streams: https://trigger.dev/product/ and https://trigger.dev/human-in-the-loop-ai-agents
- Steel browser session and profile documentation: https://docs.steel.dev/

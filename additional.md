# Runspell — Revised Product and Engineering Roadmap

## 1. Product renaming

Rename the entire product from **Relay** to **Runspell**.

Apply the change consistently across:

- Landing page and marketing content
- Dashboard and workspace
- Navigation, headers and footers
- Page titles, metadata and SEO
- Logos, branding and product references
- README and engineering documentation
- Backend service identifiers and configuration, wherever appropriate
- Package names and application manifests
- Environment variable references, with compatibility safeguards
- Existing roadmap and expansion documents

Do not blindly rename database identifiers, credentials, external integration identifiers or deployed resources in ways that break existing functionality.

Preserve the existing visual identity, animations, design language and workspace layout unless a change is necessary for the rebranding.

## 2. Product vision

**Runspell is an AI-assisted, deterministic workflow automation platform for creating, executing and monitoring reliable browser and API-based business workflows.**

Users should be able to describe a business process in natural language, convert it into a visual workflow, customize it, test it, connect their accounts and automate its execution.

Runspell should combine the accessibility of AI-assisted workflow creation with the reliability and predictability of conventional automation systems.

**Intelligence designs. Runspell executes.**

The objective is not to create another autonomous computer-use agent. The objective is to build a dependable automation infrastructure suitable for real business operations.

## 3. Core product principles

- AI-assisted authoring, deterministic execution.
- API-first integrations, browser automation wherever necessary.
- Explicit user control over external actions.
- Predictable and reproducible workflows.
- Observable and verifiable execution.
- Modular and extensible architecture.
- Simple, intuitive user experience.
- Enterprise-grade security and reliability.
- No unnecessary architectural or product complexity.

## 4. Technology stack

Preserve the existing implementation and previously selected technologies wherever compatible.

| Component                    | Technology                                   |
| ---------------------------- | -------------------------------------------- |
| Frontend                     | Next.js, React, TypeScript                   |
| Workflow canvas              | React Flow                                   |
| Animations                   | GSAP, Framer Motion                          |
| Collaboration                | Liveblocks                                   |
| Authentication               | Clerk / existing managed authentication      |
| Backend API                  | TypeScript, Fastify                          |
| Database                     | PostgreSQL                                   |
| Workflow orchestration       | Trigger.dev                                  |
| Cloud browser infrastructure | Steel.dev                                    |
| Browser automation           | Playwright, supported Stagehand capabilities |
| AI workflow generation       | Gemini through a provider-neutral interface  |
| Email delivery               | Resend                                       |
| Artifact storage             | Private object storage                       |

Use a modular architecture within a single repository. Do not introduce unnecessary microservices, secondary workflow engines or redundant infrastructure.

Verify the actual repository stack before changing dependencies. Preserve working integrations.

## 5. Core product features

### 5.1 AI Prompt Studio

Allow users to describe automation requirements in natural language.

The system should:

- Generate structured workflows using supported action schemas.
- Identify required integrations.
- Identify missing information and credentials.
- Display assumptions and limitations.
- Generate an editable workflow graph.
- Explain unsupported actions.
- Allow conversational workflow modifications.
- Present proposed changes as reviewable differences.

AI-generated workflows must remain inactive until explicitly reviewed and activated.

### 5.2 Visual Workflow Builder

Build a responsive, interactive workflow canvas supporting:

- Drag-and-drop nodes.
- Node connections.
- Configurable actions.
- Animated workflow generation.
- Manual workflow editing.
- Conditional branches.
- Input and output mappings.
- Data transformations.
- Execution status visualization.
- Workflow validation.
- Draft persistence.
- Version history.

Keep the interface clean and approachable, even when workflows become complex.

### 5.3 Hybrid Browser and API Automation

Support both browser-based and API-based actions within a single workflow.

Prefer the following execution hierarchy:

1. Official APIs.
2. Supported webhooks and integrations.
3. Browser automation when the required API functionality is unavailable.

Browser automation should support bounded, configured actions such as:

- Opening supported websites.
- Navigating between pages.
- Clicking elements.
- Filling forms.
- Extracting structured information.
- Uploading and downloading files.
- Handling authenticated browser sessions.
- Executing configured website operations.

Do not claim universal website compatibility.

### 5.4 Workflow Triggers

Support multiple execution methods:

- Manual triggers.
- Scheduled triggers.
- Webhook triggers.
- Supported application events.

All trigger types must use the same underlying execution engine.

### 5.5 Deterministic Execution Engine

Use Trigger.dev to orchestrate workflow execution.

The engine must support:

- Version-pinned execution.
- Sequential actions.
- Conditional execution.
- Typed input and output handling.
- Execution state persistence.
- Timeouts and cancellation.
- Bounded retries.
- Idempotency.
- Event deduplication.
- Resource limits.
- Browser session management.
- Execution history.

AI must not independently modify active workflows or override execution policies.

### 5.6 Reliability and Error Handling

Retain conventional, predictable reliability mechanisms:

- Configured selector fallbacks.
- Exponential backoff.
- Bounded retry policies.
- Error classification.
- Session recovery.
- Credential reconnection.
- Timeout management.
- Safe cancellation.
- Resource cleanup.
- Manual failure resolution.
- Deterministic outcome verification.

If an external action has an uncertain result, stop or request human reconciliation rather than blindly repeating it.

These mechanisms must not evolve into autonomous self-healing or self-repair.

### 5.7 Human-in-the-Loop Approvals

Allow workflows to pause and request human approval before continuing.

Support:

- Approval and rejection.
- Approval expiration.
- Sensitive-action confirmation.
- Conditional approval requirements.
- Approval history.
- Notifications.
- Secure execution resumption.

Browser sessions should not remain unnecessarily active during long approval waits.

### 5.8 Flight Recorder

Provide a transparent record of every workflow execution.

Include:

- Execution timeline.
- Individual step status.
- Execution duration.
- Input and output metadata.
- Screenshots where appropriate.
- Error details.
- Retry attempts.
- Approval decisions.
- External operation identifiers.
- Resource consumption.
- Private execution artifacts.

Generate an execution receipt distinguishing successful execution, verified external outcomes and uncertain outcomes.

### 5.9 Workflow Testing

Clearly distinguish between:

- Schema validation.
- Mock execution.
- Read-only real execution.
- Controlled write execution.
- Production execution.

Allow users to inspect the results of a test before activating a workflow.

Never present simulated execution as successful real-world automation.

### 5.10 Connections and Credential Management

Support secure connections to external applications.

Include:

- OAuth where supported.
- API key management.
- Persistent authenticated browser profiles.
- Encrypted credentials.
- Workspace-level isolation.
- Connection health checks.
- Credential revocation.
- Reconnection mechanisms.
- Permission and scope management.

Credentials must never be exposed to unauthorized users, AI prompts or application logs.

### 5.11 Workflow Versioning

Maintain:

- Editable drafts.
- Immutable activated versions.
- Revision history.
- Activation controls.
- Version-specific execution records.

Editing a workflow must not silently change an existing active version.

## 6. Future expansion

The following remain phased roadmap candidates, not mandatory first-release requirements.

### 6.1 Application integrations

Introduce demand-driven integrations such as:

- Gmail
- Google Sheets
- Google Drive
- Slack
- Microsoft Outlook
- Microsoft Teams
- CRM platforms
- Business management platforms

Prioritize integrations with demonstrated use cases.

### 6.2 Document and data processing

Support:

- PDF extraction.
- OCR.
- Structured document parsing.
- File transformations.
- Schema-based AI processing.
- Data validation.
- Evidence-backed extraction.
- Human review of uncertain results.

### 6.3 Browser workflow recording

Allow users to record consented browser interactions and convert them into editable automation drafts.

Include:

- Browser interaction recording.
- Selector generation.
- Replay testing.
- Editable recorded actions.
- Reusable workflow templates.

Never record passwords, authentication tokens or MFA secrets.

### 6.4 Reusable workflow components

Support:

- Subworkflows.
- Reusable action sequences.
- Private templates.
- Parameterized workflows.
- Version-pinned components.
- Workspace sharing.

### 6.5 Advanced workflow logic

Introduce when the core engine is stable:

- Bounded loops.
- Parallel branches.
- Branch merging.
- Dynamic waiting.
- Workspace data tables.
- Advanced data mappings.
- Controlled data extraction.
- Sandboxed data transformations.

All advanced operations must have explicit execution limits.

### 6.6 MCP and extension infrastructure

Introduce controlled support for:

- MCP integrations.
- Explicitly published workflow tools.
- Connector development interfaces.
- Authenticated tool invocation.
- Per-tool permission policies.
- Execution quotas.
- Audit logging.

MCP support must not introduce unrestricted autonomous agent execution.

### 6.7 Enterprise operations

Introduce according to demonstrated business requirements:

- Business work queues.
- Role-based access control.
- Team collaboration.
- Audit exports.
- SLA monitoring.
- Governance policies.
- Data loss prevention.
- Environment separation.
- Workflow release management.
- Version rollback.
- SSO and SCIM.

Do not prioritize enterprise expansion before completing a stable core automation platform.

## 7. Explicitly removed features

The following features have been deliberately removed from the Runspell product scope:

- AI self-healing workflows.
- Autonomous AI agents.
- Autonomous workflow repair.
- Autonomous selector repair.
- Rescue Mode.
- Unrestricted computer-use agents.
- Universal website automation promises.
- Desktop Robotic Process Automation (RPA).
- Windows desktop automation agents.
- Hosted desktop bot pools.
- Process mining.
- Automated process discovery.

Remove these features from existing roadmaps, product expansion documents, planned milestones and marketing claims.

If implementations exist, inspect their dependencies before removing them. Preserve shared functionality required by retained features.

Do not reintroduce these capabilities under different names.

Conventional retries, configured selector fallbacks, deterministic outcome verification, manual corrections and human approvals must remain.

## 8. Revised engineering milestones

### M0 — Architecture and feasibility

- Canonical workflow schemas.
- Action registry contracts.
- Execution policies.
- Draft revision contracts.
- Event streaming and replay contracts.
- React Flow and GSAP compatibility.
- Trigger.dev and Steel.dev feasibility testing.

### M1 — Workflow authoring prototype

- Prompt Studio.
- Animated workflow generation.
- Interactive visual canvas.
- Manual node editing.
- Conversational edits.
- Draft persistence.
- Workflow validation.

### M2 — Backend foundation

- Backend APIs.
- Authentication and authorization.
- PostgreSQL models.
- Workspace isolation.
- Credential management.
- Workflow persistence.
- Immutable versions.
- Execution records.
- Durable dispatch.

### M3 — AI workflow generation

- Real model integration.
- Structured workflow generation.
- Supported action registry.
- Conversational workflow modifications.
- Schema validation.
- Generation streaming.
- Token and cost controls.

### M4 — Real workflow execution

- Trigger.dev integration.
- Steel.dev browser execution.
- API actions.
- Browser actions.
- Manual triggers.
- Scheduled triggers.
- Webhook triggers.
- Human approval checkpoints.
- Outcome verification.
- Conventional reliability controls.

### M5 — Reliability and launch readiness

- Flight Recorder.
- Execution receipts.
- Workflow testing.
- Error handling.
- Retry policies.
- Manual failure resolution.
- Credential reconnection.
- Monitoring.
- Security verification.
- End-to-end integration testing.

There must be no Rescue Mode or autonomous repair functionality in this milestone.

### M6 — Integrations and document intelligence

- Additional application integrations.
- Document processing.
- Structured extraction.
- Advanced human approval tasks.
- File utilities.
- Schema-constrained AI processing.

### M7 — Recording and reusable components

- Browser workflow recorder.
- Replay editor.
- Reusable workflows.
- Templates.
- Shared components.

### M8 — Advanced workflow and extension platform

- Advanced conditional logic.
- Bounded loops.
- Parallel execution.
- Workspace tables.
- MCP integrations.
- Connector development infrastructure.
- Isolated code transformations.

### M9 — Enterprise operations

- Governance.
- Business work queues.
- Enterprise integrations.
- Auditability.
- Team administration.
- Environment promotion.
- Deployment and rollback controls.

The previous M10 milestone covering desktop RPA and process mining is permanently removed from the current roadmap.

## 9. Experimental differentiators — not approved for implementation

The following concepts were brainstormed but have not been approved:

- Runspell Certified Actions.
- Runspell API Forge.
- Runspell Contract.
- Runspell Proof.
- Runspell Reconcile.
- Runspell Time Machine.
- Runspell Undo.
- Runspell Continuity.
- Runspell Canary.
- Runspell Blast Radius.
- Runspell Economics.

Maintain these separately as research ideas. Do not include them in committed milestones or begin implementation without explicit approval.

## 10. Implementation instructions

Before making changes:

1. Inspect the entire existing repository.
2. Review all roadmap and architecture documents.
3. Identify implemented, partially implemented, mocked and planned features.
4. Compare them against this revised roadmap.
5. Identify references to removed features.
6. Identify dependencies that must be preserved.

Then:

1. Rebrand the product from Relay to Runspell.
2. Update the product roadmap and engineering documentation.
3. Remove explicitly rejected features from the committed scope.
4. Preserve all working retained functionality.
5. Remove obsolete UI elements and marketing claims.
6. Update the milestone structure.
7. Resolve contradictory milestone statuses using actual implementation evidence.
8. Validate the frontend, backend and affected integrations.
9. Run available tests, linting, type checking and build checks.
10. Produce a report describing completed changes, remaining work, blockers and verification results.

Do not mark a milestone as completed without implementation and test evidence.

Do not unnecessarily rebuild working components, introduce architectural complexity, deploy the product publicly or incur paid infrastructure costs without authorization.

Treat this document as the updated source of truth for Runspell's product direction.

## 11. Final product identity

**Product name:** Runspell

**Category:** Intelligent workflow automation platform

**Primary focus:** Reliable browser and API automation

**Product philosophy:** AI-assisted creation. Deterministic execution. Verifiable outcomes.

**Tagline:** Intelligence designs. Runspell executes.

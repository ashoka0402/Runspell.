# Runspell — Optimization and Reliability Roadmap

> Status: proposed engineering roadmap, not an implementation report.
> Goal: make the existing product faster, safer, more reliable and cheaper to operate before expanding its feature set.

## 1. Scope and development philosophy

Temporarily freeze new product features. Improve the existing and already-planned Prompt-to-Workflow, Visual Builder, GHOST (Browser Task Recorder), hybrid browser/API automation, scheduling, human approvals, verification, durable execution and Flight Recorder capabilities.

Prioritize **correctness → reliability → resilience → performance → efficiency → scalability**. Prefer deterministic behavior and measurable improvements over adding autonomous agents or AI self-healing. Do not claim universal website compatibility or guaranteed exactly-once external execution.

The target stack includes Next.js, React Flow, Liveblocks, Fastify, PostgreSQL, Gemini, Trigger.dev, Steel.dev, Playwright/Stagehand, Clerk and Resend. Verify the current implementation before applying any recommendation; GHOST and other roadmap items may still be pending.

## 2. Optimize each component

| Component | Optimization | Measure |
| --- | --- | --- |
| AI workflow generation | Use structured outputs, strict schema and action-registry validation; trim context; reuse approved plans where safe; cache by tenant, model, schema version and normalized inputs | Planning latency, token usage, valid-plan rate |
| Browser automation | Prefer deterministic Playwright actions; reuse authorized sessions within isolation and lifetime limits; use explicit waits and bounded fallbacks; avoid unnecessary navigation and fixed sleeps | Step latency, completion rate, AI calls, browser minutes |
| GHOST | Capture meaningful actions and outcomes, coalesce redundant events, parameterize user inputs, redact secrets, generate an editable workflow and test before publication | Recording-to-workflow latency, replay success, manual corrections |
| Execution engine | Run independent DAG nodes in parallel with bounded concurrency; batch state writes where safe; avoid needless scheduling hops; use immutable workflow versions | Queue latency, end-to-end latency, throughput |
| API automation | Connection pooling, keep-alive, request timeouts, safe caching of read-only data, rate limits and bounded concurrency | p95 latency, errors, request count |
| Visual Builder | Profile rendering, memoize nodes, debounce autosave, virtualize large views where appropriate and send incremental updates | Interaction latency, render count, autosave latency |
| Flight Recorder | Buffer noncritical telemetry, persist critical execution receipts durably, capture screenshots on failures or required checkpoints, redact secrets and enforce retention | Telemetry overhead, storage per run, evidence completeness |
| Outcome verification | Prefer explicit API responses, stable IDs, DOM assertions and business invariants to LLM-based checks | False-success rate, verification latency |
| Scheduling and approvals | Deduplicate triggers, validate webhook signatures, avoid keeping browsers open while awaiting approval where possible, restore and revalidate context on resume | Duplicate starts, idle browser minutes, approval resume rate |

## 3. Browser execution: deterministic-first strategy

Steel supplies remote live browser sessions. Live DOM access reduces stale-page assumptions but does not guarantee correct interpretation of changed interfaces, authentication challenges or business outcomes.

For each approved browser action:

1. Use a deterministic Playwright locator (role, accessible name, stable test ID or stable attribute).
2. If locating fails before a side effect, try bounded, predeclared semantic selector fallbacks.
3. If needed, ask Stagehand/Gemini to resolve the current page context within the original action and permission scope. Validate the candidate target and require approval for sensitive ambiguity.
4. If still uncertain, stop safely or request human intervention. Never let AI autonomously rewrite the workflow or expand its permissions.
5. Verify the expected outcome and persist the result before advancing.

If an action may already have taken effect, reconcile its outcome **before** retrying or selecting another target. Do not blindly repeat submissions, payments, emails or other irreversible actions.

Use session isolation, expiry detection, explicit navigation and action deadlines, cleanup in success/failure/cancellation paths, and authorized reauthentication for expired sessions. CAPTCHA and MFA may require human participation. Never bypass access controls.

## 4. Durable and fail-safe execution

Trigger.dev can provide orchestration, retry facilities and task-level idempotency, but duplicate external side effects still need application-level protection.

| Mechanism | Implementation direction |
| --- | --- |
| Idempotency | Stable run and node execution IDs; unique DB constraints; downstream idempotency keys where supported; reconcile ambiguous side effects |
| Checkpointing | Persist immutable workflow version, node state, attempts, outputs, dependencies, receipts and required browser-state references |
| Retry policy | Classify transient, permanent, authentication and ambiguous-side-effect failures; exponential backoff with jitter; bounded attempts and deadlines |
| Circuit breaker | Stop or defer calls to persistently failing dependencies; use cooldowns and limited probes |
| Dead-letter handling | Preserve failed runs with error context and safe manual redrive; reconcile side effects before resuming |
| Backpressure | Queue limits, per-workspace quotas, rate limits and browser/worker concurrency caps |
| Session restoration | Restore authorized context where possible; otherwise rebuild safe navigation state and revalidate before resuming |
| Graceful degradation | Preserve confirmed progress during dependency outages; defer optional telemetry; fail closed when correctness or permissions cannot be verified |
| Resource cleanup | Idempotent session release, cancellation handling, TTLs and orphan-session reconciliation |
| Timeout management | Separate per-action, per-node, session and overall-run deadlines; no indefinite waits |

Suggested node states: pending, running, awaiting_approval, verifying, succeeded, retrying, failed, cancelled and outcome_unknown.

### Recovery sequence

- Persist intent and a stable operation identifier before invoking an external mutation.
- Execute the approved action, using a downstream idempotency key if available.
- Verify the business outcome and persist its receipt.
- On interruption, inspect checkpoints and reconcile any uncertain side effect.
- Restore/rebuild browser context if needed; resume only eligible nodes, not the entire workflow.
- If reconciliation is impossible, stop with outcome_unknown and request review.

Exactly-once behavior cannot be guaranteed for arbitrary third-party websites without cooperation. Aim for safe replay and explicit handling of uncertain outcomes.

## 5. Security baseline

Even during MVP optimization, preserve tenant isolation, server-side authorization, encrypted credentials, scoped access, outbound URL validation and SSRF defenses, webhook authentication, log/screenshot redaction and human approval of sensitive actions. Treat webpage content and LLM outputs as untrusted. Never put credentials in prompts, telemetry or recorded workflows. Scope caches and browser sessions to authorized tenants/accounts. Ensure verification and approval cannot be skipped through retries.

## 6. Benchmarking and acceptance targets

First capture a reproducible baseline. Use fixed representative workflows, defined browser/provider configurations, cold and warm runs, concurrency levels and consistent datasets. Report p50/p95/p99, sample size, failures, provider errors and cost per successful run. Separate internal overhead from external website and provider latency.

| Metric | Proposed initial target |
| --- | --- |
| Verified workflow success on supported test sites | >= 99% |
| Internal API latency (p95, excluding external operations) | < 200 ms |
| Duplicate external side effects in controlled fault tests | 0 observed |
| AI calls for repeated workflows | 80% reduction from baseline |
| Cost per successful representative workflow | 50% reduction from baseline |
| Orphaned browser sessions after cleanup window | 0 observed |
| Cross-tenant data leaks in security tests | 0 observed |

These are aspirational targets, not current results, guarantees or service-level commitments. Adjust after measuring the baseline. Track failure categories, queue depth, run duration, browser minutes, token consumption, verification failures, time to recover and retry counts. Compare each change against the baseline and reject regressions in correctness or security.

## 7. Chaos and failure testing

Use controlled test environments and mock dependencies, not live financial or customer systems.

| Fault injected | Expected behavior |
| --- | --- |
| Browser crash during an action | Reconcile outcome, restore session or request review |
| Worker termination mid-workflow | Recover from durable checkpoints without repeating completed side effects |
| Gemini outage or malformed output | Bound retries; reject invalid plans; deterministic approved actions remain usable where possible |
| Steel outage or disconnect | Apply bounded recovery; release sessions; preserve state |
| Database outage | Stop unsafe mutations if intent/receipt cannot be durably recorded; reconcile on recovery |
| Expired authentication / MFA | Pause for authorized reauthentication |
| Duplicate webhook or concurrent run delivery | Deduplicate within intended execution scope |
| Overload and third-party rate limiting | Queue/backpressure, fair concurrency and bounded retry |
| External action succeeds but response is lost | Reconcile instead of blindly retrying |
| Changed DOM, ambiguous target, unexpected popup | Use bounded fallbacks or safe human review |
| Cancellation or rejected approval | Stop future actions and release resources; disclose already completed effects |

Record expected versus observed outcomes. Require regression tests for every discovered failure mode.

## 8. Implementation order

1. **Baseline and scope freeze:** inventory implemented features, establish a representative test suite and instrument latency, reliability and cost.
2. **Correctness:** enforce workflow schemas, immutable versions, action permissions and deterministic outcome checks.
3. **Resilience:** add step-level idempotency, checkpoints, failure classification, reconciliation, bounded retries and resource cleanup.
4. **Browser and AI optimization:** deterministic-first execution, controlled semantic fallback, token reduction and GHOST recording normalization.
5. **Performance:** bounded parallel execution, database and connection optimization, frontend profiling and selective telemetry.
6. **Production hardening:** chaos tests, load tests, tenant isolation checks, quotas, circuit breakers and regression gates.

Treat GHOST as an existing roadmap capability, not permission to add unrelated features. If it is not yet implemented, complete only the agreed recording/replay scope before optimizing it.

## 9. Definition of done

- Approved workflows execute correctly and produce verifiable evidence.
- Interrupted workflows can resume safely or stop in an explicit uncertain state.
- Tests demonstrate no observed duplicate side effects, session leaks or cross-tenant exposure.
- Performance and cost improvements are measured against a documented baseline.
- No optimization bypasses validation, human approvals, permissions or outcome verification.
- New feature development resumes only after reviewing the reliability and performance results.

**Product principle:** describe it, demonstrate it, or build it manually — then execute it reliably, safely and efficiently.

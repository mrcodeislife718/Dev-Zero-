# Dev-Zero Technical Superiority Architecture

## Product definition

Dev-Zero is a **local-first autonomous agentic software-engineering team**. It is not merely a sandbox, command daemon, or backend for another product. It owns sustained engineering work on real repositories: repository understanding, planning, decomposition, specialist assignment, implementation, debugging, testing, review, security, documentation, release preparation, memory, recovery, model routing, and operator control.

Dev-Zero must remain independently usable by a developer or organization that wants an autonomous engineering team operating on machines and repositories they control.

## Winning objective

Dev-Zero wins if a user can give it engineering work and receive verified repository outcomes with better continuity, privacy, cost control, throughput, isolation, recovery, and autonomous-team quality than alternative local/self-hosted coding-agent systems.

## Competitive reference set

### OpenHands / Agent Canvas

Strengths: self-hosted always-on agent control center, local/remote/cloud backends, multiple interchangeable agents, automations, third-party integrations, model independence.

Weaknesses to structurally eliminate: unsafe no-sandbox mode can expose the filesystem; backend flexibility does not guarantee host enforcement; agent/back-end fragmentation can complicate reliable recovery and completion ownership.

### mini-SWE-agent / SWE-agent

Strengths: very small execution hot path, independent subprocess actions, broad sandbox portability, strong benchmark discipline, model independence, high debuggability.

Weaknesses to eliminate: single-agent/issue-solving focus is narrower than an autonomous engineering organization; unrestricted bash-oriented agency is not itself a governance model; persistent team memory and long-running product coordination are outside the minimal core.

### GitHub Copilot cloud agent

Strengths: background execution, repository planning, custom specialists, ephemeral environments, automation, integrated PR workflow.

Weaknesses to eliminate: cloud/GitHub dependency, one-repository/one-branch session constraints, hard execution-duration limits, Actions/credit cost coupling, weaker local-first privacy/control.

### Claude Code / Codex / local agent CLIs

Strengths: strong interactive coding, tool use, provider models, local workflows, permissions/sandboxing.

Weaknesses to eliminate: session-centric continuity, provider dependence, limited persistent multi-agent team coordination, and variable recovery semantics.

## Architecture principles

1. **Team, not swarm.** Every worker has a role, task, authority, budget, workspace, and verifier.
2. **Local-first means enforceable control.** Never advertise containment that the host cannot actually enforce.
3. **Durability above session continuity.** Work survives client, model, daemon, and machine interruption.
4. **Independent actions, durable coordination.** Keep worker execution simple while keeping orchestration state rich and persistent.
5. **Repository evidence determines completion.** Agent self-reports do not.
6. **Use premium compute selectively.** Model choice is an optimization decision, not a product dependency.
7. **Bound everything that can explode.** Workers, processes, retries, network, memory, CPU, evidence, output, and spend.

## Improved architecture

### 1. Durable Team Coordinator and Dependency Scheduler

1. **Purpose:** make Dev-Zero operate as an engineering team instead of sequential isolated commands.
2. **Mechanism:** persist missions, milestones, dependency DAGs, task states, specialist role requirements, acceptance criteria, risk tier, worker lease, repository/worktree ownership, verifier assignment, and integration state. Dispatch only dependency-ready tasks.
3. **Expected advantage:** parallel useful work, clear ownership, restart-safe coordination, lower conflict rates.
4. **Tradeoff:** more persistent metadata and scheduling logic.
5. **Failure mode:** incorrect dependencies create deadlock, starvation, or unsafe concurrency.
6. **Measurement:** verified tasks/hour, dependency wait, scheduler p95 latency, conflict/rework rate, recovery loss.
7. **Benchmark:** materially faster wall-clock completion on mixed project graphs at 4/8/16 workers while keeping conflict-induced repair below 5%.
8. **Fallback:** reduce conflicting task groups to serial execution and expose blocked dependency reasons.
9. **Validation experiment:** execute identical DAGs at multiple worker counts with injected worker crashes and compare final repository/evidence equivalence.

### 2. Worker Lease, Heartbeat, and Orphan Recovery

1. **Purpose:** prevent tasks from becoming permanently stuck when a worker/model/process disappears.
2. **Mechanism:** active task assignments carry leases and heartbeats. Expired leases move to `recovery-required`; the runtime checks process state, worktree state, command journal, and evidence before deciding resume, rollback, or reassignment.
3. **Expected advantage:** reliable long-running autonomy with deterministic orphan handling.
4. **Tradeoff:** heartbeat writes and recovery logic.
5. **Failure mode:** slow work is incorrectly classified as dead, causing duplicate execution.
6. **Measurement:** orphan detection time, false-orphan rate, duplicate side effects, mean recovery time.
7. **Benchmark:** zero duplicate mutations across killed-worker fault tests; recover or safely quarantine 100% of expired assignments.
8. **Fallback:** mark outcome ambiguous and require reconciliation rather than automatically rerunning mutating work.
9. **Validation experiment:** kill workers before, during, and after side effects while independently dropping command responses.

### 3. Enforceability-Probed Isolation

1. **Purpose:** make local security claims reflect what the host can actually enforce.
2. **Mechanism:** at startup and on material environment change, probe filesystem isolation, network namespace isolation, process-tree termination, memory/CPU limiting, and relevant platform controls. Advertise only successfully proven capabilities. Required unavailable controls fail closed.
3. **Expected advantage:** fewer false-security assumptions than systems that equate installed tools with enforceable sandboxing.
4. **Tradeoff:** platform-specific probes and environments where strict mode cannot run.
5. **Failure mode:** probe succeeds but later runtime policy/environment changes break enforcement.
6. **Measurement:** capability-probe accuracy, escape tests, policy bypass count, false-positive capability claims.
7. **Benchmark:** 0 advertised isolation capabilities that fail the corresponding adversarial enforcement test.
8. **Fallback:** reject commands requiring unavailable controls or use a stronger configured backend/container/VM.
9. **Validation experiment:** run the same probe/adversarial corpus on normal Linux, restricted CI runners, containers, and intentionally misconfigured hosts.

### 4. Durable Idempotent Command Journal

1. **Purpose:** prevent duplicate side effects from retries, disconnects, daemon crashes, or client uncertainty.
2. **Mechanism:** persist normalized command intent digest, idempotency key, lifecycle, process identity, result/evidence, and ambiguity state before execution. Repeated identical completed dispatches return the prior result; different intent with the same key is rejected.
3. **Expected advantage:** safer retries, deterministic recovery, lower repair cost.
4. **Tradeoff:** persistent journal growth and cleanup policy.
5. **Failure mode:** crash occurs after side effect but before result durability.
6. **Measurement:** duplicate mutation count, ambiguous outcomes, reconciliation latency.
7. **Benchmark:** zero duplicate mutations under repeated identical dispatch and dropped-response fault injection.
8. **Fallback:** quarantine ambiguous entries and require explicit reconcile/rollback rather than rerun.
9. **Validation experiment:** terminate the daemon at each journal/execution transition and verify restart behavior.

### 5. Resource-Aware Team Scheduler and Backpressure

1. **Purpose:** keep autonomy useful on laptops and modest hardware rather than requiring cloud-scale compute.
2. **Mechanism:** schedule workers using measured CPU, RAM, process count, disk, verification backlog, model endpoint capacity, and configured budgets. Reserve capacity for verifier/recovery work and queue excess tasks.
3. **Expected advantage:** predictable local responsiveness, lower OOM/thrash risk, better cost efficiency.
4. **Tradeoff:** less raw parallelism than unrestricted fan-out.
5. **Failure mode:** inaccurate resource estimates cause under-utilization or host contention.
6. **Measurement:** peak RAM/CPU, host responsiveness, queue latency, task throughput, OOM rate.
7. **Benchmark:** at 10x offered work, remain inside configured host ceilings and degrade through queueing instead of process explosion.
8. **Fallback:** lower concurrency, switch eligible tasks to lower-resource models, pause background tasks.
9. **Validation experiment:** load-test on 4/8/16/32GB machines with mixed build/test/model workloads and measure useful completed work per resource-hour.

### 6. Specialist Separation with Verification Quorum

1. **Purpose:** improve team quality beyond a single agent that builds and approves its own work.
2. **Mechanism:** planner, builder, debugger, tester, reviewer, security, and documentation roles have distinct task contracts. Consequential changes require at least one independent verifier; high-risk work can require security/release approval.
3. **Expected advantage:** lower defect escape and stronger maintainability/security.
4. **Tradeoff:** increased model calls and coordination.
5. **Failure mode:** role separation is cosmetic because all roles share identical context/model failure patterns.
6. **Measurement:** hidden-test pass rate, escaped defects, reviewer disagreement, security finding rate, review cost.
7. **Benchmark:** outperform single-agent self-review on seeded-defect and hidden-acceptance suites.
8. **Fallback:** escalate disputed work to a stronger/different model or operator rather than repeated same-model voting.
9. **Validation experiment:** compare same-model self-review, separated same-model roles, and heterogeneous verifier configurations.

### 7. Local-First Adaptive Model and Cost Router

1. **Purpose:** make local/private operation economically competitive while preserving quality.
2. **Mechanism:** maintain per-task-class outcome data and route according to privacy, latency, context size, historical success, local capacity, and cost. Prefer qualified local models for routine work; escalate only when confidence/verification warrants it.
3. **Expected advantage:** lower cloud cost, lower data exposure, graceful provider failure, model independence.
4. **Tradeoff:** local models can increase retries and resource contention.
5. **Failure mode:** local-first routing spends more total time/cost on repeated failures.
6. **Measurement:** cost per verified task, local completion rate, escalation rate, latency, repair frequency.
7. **Benchmark:** match required quality at materially lower external-model spend than premium-only routing.
8. **Fallback:** task-class pinning or direct escalation when local historical qualification falls below threshold.
9. **Validation experiment:** run identical engineering corpus under local-only, premium-only, and adaptive policies.

### 8. Repository Intelligence with Fingerprint-Based Invalidation

1. **Purpose:** gain speed from durable repository knowledge without trusting stale context.
2. **Mechanism:** persist architecture, commands, conventions, hotspots, prior failures, and validated workflows against source/configuration fingerprints. Invalidate facts whose dependency scope changed; preserve unaffected knowledge.
3. **Expected advantage:** faster starts, lower repeated indexing/token cost, more consistent engineering behavior.
4. **Tradeoff:** dependency tracking and invalidation complexity.
5. **Failure mode:** stale repository knowledge steers a worker incorrectly.
6. **Measurement:** cache hit rate, stale-context incidents, startup latency, indexing cost.
7. **Benchmark:** large-repo warm start materially faster than cold analysis with zero accepted stale-rule violations in mutation tests.
8. **Fallback:** broad re-index when impact scope cannot be proven.
9. **Validation experiment:** mutate package scripts, architecture boundaries, config, and unrelated files and verify selective invalidation.

### 9. Continuous Verification and Repair Pipeline

1. **Purpose:** minimize the distance between defect creation and diagnosis.
2. **Mechanism:** run targeted validation after each bounded change, broader validation at integration, and complete release qualification before completion. Failures are normalized, diagnosed, repaired within explicit retry/time/spend budgets, and preserved as evidence.
3. **Expected advantage:** lower wasted work and higher completion reliability.
4. **Tradeoff:** verification overhead.
5. **Failure mode:** test selection misses a transitive regression.
6. **Measurement:** detection latency, repair distance, full-suite regression rate, retries, verification cost.
7. **Benchmark:** lower mean defect-detection distance than end-only validation with no increase in escaped regressions.
8. **Fallback:** full validation when dependency impact is uncertain.
9. **Validation experiment:** seed local and transitive defects at different lifecycle stages and compare targeted/full detection.

### 10. Completion Contract and Release Readiness

1. **Purpose:** make Dev-Zero deliver engineering outcomes rather than stop after code generation.
2. **Mechanism:** every mission declares done conditions covering implementation, tests, security, migrations, documentation, build/package, and release-specific obligations. Completion requires evidence coverage and clean integration state.
3. **Expected advantage:** stronger autonomous ownership and lower operator cleanup burden.
4. **Tradeoff:** more work for tasks that only need a small patch; support lightweight mission profiles.
5. **Failure mode:** done contract is incomplete.
6. **Measurement:** post-agent manual repair time, reopened tasks, acceptance coverage, ship-readiness pass rate.
7. **Benchmark:** materially reduce human finishing work after autonomous execution compared with patch-centric baselines.
8. **Fallback:** return `unqualified` plus uncovered obligations.
9. **Validation experiment:** project scenarios with hidden migration, docs, test, and release requirements.

## 1x / 10x / 100x analysis

### 1x

Single machine, one repository, 1-4 active workers. Main objectives: safe setup, strong isolation, fast repository awareness, reliable execution, low idle memory, and simple operator control.

### 10x

Many repositories and 10-40 workers. Resource scheduling, worktree ownership, model endpoint capacity, verifier throughput, command journal growth, and memory invalidation dominate. Use backpressure and per-repository conflict domains.

### 100x

Large self-hosted engineering fleet. SQLite/local single-host state can become a bottleneck; coordinator state must support partitioning or a pluggable durable store without changing worker contracts. Observability must aggregate rather than stream every event to humans. Worker/provider pools require admission control and fairness.

## Success-too-well failure modes

- Cheap local workers saturate RAM/CPU and starve verification.
- Persistent memory grows until retrieval quality decreases.
- Successful automation causes too many simultaneous repositories to be attached safely.
- Model-routing optimization overloads one local inference server.
- Verification becomes the throughput bottleneck while builders remain idle.
- Worktree count and object storage grow faster than cleanup.

Controls: resource admission, verifier reservation, memory quality/retention policy, repository quotas, endpoint capacity models, worktree lifecycle cleanup, evidence compaction, and bounded queues.

## Comparative evidence plan

1. SWE-bench and current harder coding benchmarks for issue-resolution capability.
2. Multi-agent project benchmark with independent/dependent tasks, hidden requirements, and release qualification.
3. OpenHands/mini-SWE-style local execution comparison for startup latency, memory, isolation, and cost.
4. Forced daemon/worker/model interruption matrix for recovery and duplicate-side-effect proof.
5. 4/8/16/32GB host qualification for resource efficiency.
6. Local-only vs premium-only vs adaptive model-routing cost/quality comparison.
7. Single worker vs coordinated specialist team quality and throughput.
8. Isolation adversarial suite proving filesystem/network/process/resource boundaries.
9. Long-running mission tests beyond ordinary chat/session duration.
10. Operator burden: interventions, approvals, manual repairs, and time-to-understand state.

Dev-Zero may claim superiority only where these comparisons demonstrate it. Its architectural target is the best persistent, local-first autonomous software-engineering team for operating on real repositories.
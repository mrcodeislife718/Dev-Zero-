# Dev-Zero Audit-Closure Architecture

## Scope lock

This branch implements only the governed local-worker runtime already approved for Dev-Zero. No placeholder, mock, demo-only, speculative, browser, UI, or unrelated product surface is permitted.

Approved work:
1. Persistent local runtime/daemon.
2. Repository attachment and isolated Git worktrees for parallel workers.
3. Durable logical worker identity with disposable provider/model sessions.
4. Task lifecycle with resume/recovery after process interruption.
5. Structured command intents with cwd, filesystem, network, environment, timeout, CPU/memory and approval policy.
6. Controlled process execution with cancellation and bounded output.
7. Evidence records tied to actual command results and file state.
8. Checkpoints and rollback.
9. Authenticated local API and CLI for the runtime.
10. Structured failure taxonomy and recovery metadata.

## Competitive engineering inputs

Useful strengths from coding-agent runtimes and durable workflow systems are adopted only inside the approved runtime: isolated worker contexts, pre-execution policy interception, durable state transitions, bounded resource execution, and resumable work.

## Runtime architecture

CLI/API -> persistent daemon -> task store -> logical worker -> provider session binding -> authority evaluator -> worktree manager -> command runtime -> verifier/evidence writer -> checkpoint/rollback -> durable task state.

The provider/model is replaceable. The logical worker, task, repository, authority and evidence identities survive provider replacement.

## Evidence plan

### Persistent task/runtime state
Purpose: survive daemon/process restarts.
Mechanism: transactional SQLite state with explicit migrations and recovery of interrupted running tasks.
Expected advantage: deterministic resume rather than conversation-memory dependence.
Tradeoff: local database lifecycle must be maintained.
Failure mode: crash between process completion and state commit.
Measurement: forced-restart recovery tests.
Benchmark: interrupted running tasks recover to a non-running reviewable state without data loss.
Fallback: checkpoint rollback.
Validation: restart/fault tests.

### Worktree isolation
Purpose: prevent parallel workers from overwriting one another.
Mechanism: one owned Git worktree per task/worker execution context.
Expected advantage: clean diff/conflict boundaries.
Tradeoff: additional disk use and Git lifecycle management.
Failure mode: stale worktrees or conflicting integration.
Measurement: parallel isolation tests.
Benchmark: no task may write through another task's worktree path.
Fallback: stop task and preserve worktree for review.
Validation: parallel task test plus path-escape tests.

### Governed command execution
Purpose: execute real commands without granting blanket machine authority.
Mechanism: deny-by-default command intent, allowlisted cwd/filesystem, sanitized env, optional network, timeout/resource limits, approval tiers and process-tree cancellation.
Expected advantage: safer local autonomy.
Tradeoff: some legitimate operations require explicit authority.
Failure mode: child process escapes limits or command policy is incomplete.
Measurement: adversarial command matrix.
Benchmark: known path/network/privilege escapes are denied before spawn.
Fallback: reject and require replan/approval.
Validation: policy and process tests.

### Evidence and rollback
Purpose: prove what happened and recover from bad changes.
Mechanism: hash command inputs/results and repository state; create Git-backed checkpoints before mutating operations and support restore.
Expected advantage: verifiable outcomes and bounded recovery.
Tradeoff: storage overhead.
Failure mode: checkpoint missing or restore incomplete.
Measurement: rollback/failure-injection tests.
Benchmark: changed files return to checkpoint state after rollback.
Fallback: preserve worktree and block completion.
Validation: mutation/rollback tests.

## Scale analysis

1x: single worker/task; correctness and recovery dominate.
10x: parallel worktrees and process/resource contention require bounded concurrency.
100x: local machine saturation becomes primary; scheduler must reject or queue work rather than overcommit CPU/RAM/disk.

Success-too-well risk: many successful workers can exhaust disk, file descriptors or verification capacity. The daemon must cap active work and preserve queued durable tasks rather than spawning unbounded processes.

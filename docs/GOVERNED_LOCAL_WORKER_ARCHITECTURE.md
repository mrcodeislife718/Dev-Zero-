# Governed Local Worker Architecture

## Decision

Dev-Zero is the local worker system. Its job is to turn approved engineering tasks into controlled work on real machines and repositories while preserving isolation, continuity, observability, recovery, and operator authority.

DevSpace is a useful competitive reference for external-to-local access, worktree-based parallelism, persistent local agents, and provider-session separation. Dev-Zero should absorb the useful capability patterns without depending on DevSpace.

## Runtime responsibility

Dev-Zero owns:

- persistent local execution state;
- approved repository and workspace attachment;
- isolated worker workspaces / Git worktrees;
- filesystem and patch operations;
- controlled command execution;
- process lifecycle management;
- local tools and browser execution;
- resource limits and cancellation;
- checkpointing and rollback;
- resume after interruption;
- local agent/provider process management;
- structured execution failures;
- governed artifact ingress and egress.

Dev-Zero does not own Codeable's product planning or Sessions' historical truth. It executes approved work and returns evidence.

## Shared persistent daemon

All clients should talk to the same authoritative local runtime state. CLI, editor, MCP, local API, browser UI, and future interfaces must not create independent hidden runtimes.

The daemon should persist enough state to recover from client disconnects and process restarts, including:

- active runs and tasks;
- workspace/worktree ownership;
- worker identity references;
- provider session references;
- command/process state;
- approvals and policy decisions;
- checkpoints;
- verification state;
- retry/recovery state.

## Logical worker versus provider session

A logical worker is durable. A provider session is disposable.

Example:

```text
Dev-Zero Worker: builder-17
  role: Builder
  task: implement authentication callback
  authority: repository-write + test-run

Provider session A: local Qwen
  -> fails

Provider session B: Codex
  -> continues the same worker/task
```

The task and worker history must not be lost because the model/provider changed.

## First-class parallel isolation

Parallel workers should receive separate workspaces, preferably Git worktrees where appropriate.

The runtime must track:

- repository;
- branch;
- worktree path;
- owning task;
- owning worker;
- base revision;
- changed files;
- locks/conflicts;
- verification state;
- integration state;
- cleanup state.

Worktrees prevent workers from casually overwriting one another, but they are not a complete operating-system sandbox.

## Stronger command safety

Dev-Zero must not equate "inside the workspace" with "safe." Shell commands run with operating-system power unless deliberately constrained.

Commands should enter the runtime as structured intent containing:

- command class;
- executable;
- arguments;
- working directory;
- allowed filesystem paths;
- network access policy;
- environment-variable allowlist;
- secret access requirements;
- timeout;
- resource limits;
- approval tier;
- expected result;
- verifier.

The runtime should distinguish ordinary engineering commands from elevated-risk actions such as destructive deletion, privilege escalation, SSH, arbitrary download/upload, container/cluster administration, infrastructure mutation, package publication, force push, database migration, production deployment, and secret access.

## Runtime containment

Where supported, Dev-Zero should progressively layer containment rather than rely only on path checks:

- workspace/path allowlists;
- process environment sanitization;
- network restrictions;
- CPU/RAM/time limits;
- subprocess-tree termination;
- user/namespace/container isolation where appropriate;
- secret brokers rather than raw credential exposure;
- deny-by-default high-risk command classes;
- approval gates for consequential operations.

## Execution evidence

Every material operation should return structured evidence, not merely console text. Evidence should include enough information to reconstruct what happened:

- worker and task reference;
- command/tool;
- normalized arguments;
- working directory;
- policy decision;
- start/end time;
- exit/result status;
- bounded stdout/stderr or artifact reference;
- changed-file hashes where relevant;
- verification result;
- checkpoint/rollback reference.

## Structured failure taxonomy

The runtime should normalize failures into categories such as:

- provider failure;
- filesystem failure;
- command failure;
- policy denial;
- authority denial;
- timeout;
- resource exhaustion;
- dependency failure;
- repository-state conflict;
- concurrency conflict;
- verification failure;
- runtime invariant failure.

Each failure should declare whether it is retryable, recoverable, requires replanning, requires approval, requires rollback, or permits switching provider.

## Artifact transfer

External files entering or leaving the local environment must be deliberate operations. The runtime should validate paths, destinations, authorization, provenance, size limits, lifecycle, and whether the transfer is one-shot or reusable.

## Relationship to Codeable

Codeable may use Dev-Zero as its preferred local execution adapter:

```text
Codeable objective/task
  -> authority decision
  -> Dev-Zero execution contract
  -> isolated local execution
  -> verification/evidence
  -> result returned to Codeable
```

Dev-Zero remains independently usable by other orchestrators.

## Relationship to Sessions

Dev-Zero should emit execution facts suitable for Sessions: workspace/worktree creation, tool execution, command execution, file changes, verification, failure, retry, checkpoint, rollback, and completion.

## Relationship to Axion

Dev-Zero should consume durable worker/system identity and declared authority metadata where configured, while still applying local policy before execution.

## Product invariant

No model, agent, MCP client, or external service receives unrestricted machine authority merely because it can connect to Dev-Zero.

The runtime should always be able to answer:

> Which worker requested this operation, which task justified it, what local authority allowed it, what machine resources did it touch, what changed, and how can it be stopped or reversed?
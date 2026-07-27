# Dev-Zero

**A local-first autonomous software engineering runtime built to operate as a disciplined in-house development team.**

Dev-Zero plans, inspects, builds, repairs, tests, reviews, hardens, documents, and prepares software for release across real repositories. It is designed for sustained engineering execution—not conversational code suggestions or uncontrolled one-shot generation.

The runtime is optimized around a persistent local daemon, explicit task contracts, structured patch plans, verification-first execution, durable repository memory, and direct operator control.

## Product role

Dev-Zero supports:

- greenfield application development;
- feature implementation;
- debugging and repair;
- refactoring;
- repository hardening;
- browser and route validation;
- release preparation;
- continuation across long-running projects;
- repeated work across multiple repositories.

Its objective is to reduce the gap between a software goal and a verified repository outcome while preserving visibility, control, and recovery at every stage.

## Core operating loop

```text
Attach repository
    -> Build repository profile
    -> Normalize objective
    -> Create milestones and task graph
    -> Inspect relevant source
    -> Generate bounded patch plan
    -> Request approval when required
    -> Execute tools
    -> Run targeted verification
    -> Diagnose and repair failures
    -> Review diff and acceptance criteria
    -> Checkpoint result
    -> Persist lessons and continue
```

No task is complete because an agent says it is complete. Completion is determined by acceptance criteria, repository state, command results, and verification evidence.

## Runtime architecture

```text
Dev-Zero
├── Local daemon
├── CLI / terminal operator console
├── VS Code bridge
├── Session dashboard
├── Coordinator state machine
├── Planning and task graph
├── Specialist agent system
├── Repository intelligence
├── Tool runtime
├── Verification and repair engine
├── Memory and context engine
├── Policy and approval engine
├── Checkpoint and recovery system
├── Model and cost router
├── Browser runtime
└── Optimization layer
```

### Persistent daemon

The daemon is the authoritative runtime. It owns sessions, runs, event streams, task scheduling, persistence, tool execution, approvals, and local APIs. The CLI and editor integration are clients of the same operating state.

### Coordinator

A schema-driven state machine controls task transitions, dependencies, agent routing, replanning, verification, stop conditions, retries, and final completion decisions.

### Planning system

Plans are grounded in the actual repository and contain:

- normalized objective;
- repository summary;
- assumptions and risks;
- milestones;
- dependency-aware tasks;
- file and command targets;
- acceptance criteria;
- assigned specialist;
- verification strategy;
- explicit done conditions.

### Repository intelligence

Dev-Zero builds reusable repository profiles and quick-start cards containing architecture, languages, frameworks, commands, conventions, hotspots, rules, prior failures, and validated workflows.

### Structured execution

Agents do not receive unrestricted write authority. Code changes are expressed as bounded patch plans, executed through controlled tools, inspected as diffs, and verified before they are accepted.

## Specialist engineering team

| Agent | Responsibility |
|---|---|
| Orchestrator | Advances the run, handles pause/resume, replanning, and completion |
| Planner | Converts objectives into milestones, tasks, dependencies, and gates |
| Repository Analyst | Identifies architecture, relevant files, commands, and risks |
| Builder | Produces focused implementation changes |
| Debugger | Performs root-cause analysis and repair planning |
| Tester | Runs and creates targeted verification |
| Reviewer | Applies criteria-based quality gates and suspicious-change checks |
| Security | Detects unsafe commands, secret exposure, and configuration risks |
| Documentation | Produces repository cards, run summaries, and operating documentation |

## Tool runtime

Dev-Zero operates through explicit, observable tools for:

- filesystem inspection;
- bounded file modification;
- structured patch application;
- terminal commands;
- Git status, branches, diffs, and checkpoints;
- browser launch and navigation;
- route and smoke testing;
- console-error capture;
- screenshots and focused DOM assertions;
- test, build, lint, and type-check execution.

## Verification and repair

- Scoped checks during implementation
- Broader checks at completion
- Diagnostic normalization
- Root-cause-driven repair
- Bounded retry limits
- Stuck-loop detection
- Replanning or explicit stop
- Criteria-based diff review
- Checkpoint before consequential changes
- Resume after interruption or failure

## Runtime modes

### Surgical

Minimal-file, minimal-diff operation for small, high-confidence changes.

### Builder

Feature-development mode with broader but still bounded implementation scope.

### Recovery

Debugger-first operation optimized for diagnostics and fast fix/verify loops.

### Analysis

Read-only repository investigation, memory retrieval, architecture analysis, and planning.

### Ship-Prep

Release hardening, documentation, broad verification, security review, and readiness checks.

## Mission presets

- `new-saas`
- `mobile-app`
- `design-system`
- `microservice`
- `debug-existing-repo`
- `hardening-pass`
- `ship-readiness`
- `continue-last-run`

## Operator interfaces

### CLI / TUI

The terminal console surfaces the task graph, event stream, approvals, memory hits, diagnostics, verifier state, Git state, diffs, active agents, and current run. The operator can pause, resume, approve, reject, inspect, cancel, and continue without leaving the console.

Representative commands include:

```bash
devzero attach .
devzero build "Create feature X"
devzero fix
devzero continue
devzero review
devzero doctor
devzero test-ui
devzero refactor "..."
devzero ship-prep
```

### VS Code bridge

The editor integration attaches the active repository, sends selected context, starts tasks, shows run status, and opens diffs while leaving execution authority in the daemon.

### Local API

The runtime exposes local session, run, event, approval, cancellation, resume, and repository-scan interfaces for the CLI, editor bridge, and approved automation clients.

## Memory and continuous improvement

Dev-Zero preserves:

- repository conventions;
- architecture decisions;
- successful commands;
- recurring diagnostics;
- failure and repair history;
- operator preferences;
- task outcomes;
- checkpoint lineage;
- model-routing results.

Successful repairs and stable repository conventions become future speedups rather than disappearing when a chat window closes.

## Model routing and performance

The runtime is model-agnostic and can route work between hosted and local providers according to task type, complexity, privacy, latency, confidence, and cost. Lightweight work does not require premium-model execution, and retries remain budgeted and observable.

Performance features include:

- incremental repository scans;
- cached repository intelligence;
- contextual compression;
- selective file inspection;
- incremental verification;
- safe parallel execution;
- model-tier routing;
- fast resume from persisted state.

## Safety and control

- No writes outside the workspace boundary
- No silent destructive operations
- Explicit approval for risky actions
- Environment and secret protection
- Schema-based runtime control
- No unrestricted free-text outputs driving execution
- Diff-size and file-scope controls
- Retry and budget limits
- Cancellable commands and runs
- Checkpoints and rollback before major changes
- No completion claim without verification

## Commercial deployment

Dev-Zero is designed as a local-first engineering product for developers, technical founders, and organizations that want high-autonomy software execution without surrendering repository access, operational visibility, or source privacy to a multi-tenant service.

Deployment and licensing can be structured around private workstations, controlled company environments, and organization-specific engineering policies.

## Engineering significance

Dev-Zero demonstrates the implementation of an autonomous engineering runtime as a real systems product: persistent control plane, repository intelligence, multi-agent coordination, machine tools, policy boundaries, repair loops, memory, browser validation, model routing, resumability, and release evidence.

## Relationship to Codeable

Dev-Zero is an independent product. It is not Codeable and is not represented as a renamed Codeable subsystem. Each product has its own architecture, operating model, source, and commercial identity.

## Repository boundary

This repository is the controlled public product and technical-documentation surface for Dev-Zero. Proprietary production source, model-routing logic, execution policies, private integrations, and commercial distribution packages are maintained privately.

## Ownership and licensing

Dev-Zero is independently designed and developed by **Charles Castillo**, Software Engineer and AI Systems Engineer.

All rights reserved. No source, architecture, documentation, branding, or commercial rights are granted without explicit written authorization.
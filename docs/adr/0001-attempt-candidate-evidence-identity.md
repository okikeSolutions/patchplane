# ADR 0001: Attempt, candidate, evidence, and supersession identity

- Status: Accepted
- Date: 2026-07-25

## Context

PatchPlane must answer whether one specific AI-generated patch attempt has earned human trust. Provider success signals are insufficient: Pi exit `0` only completes agent execution, a captured diff is not independent verification, and external-review confidence is not a test result. Reruns and publication retries also make “latest row wins” unsafe.

## Decision

### Attempt

A V1 `WorkflowRun` is one immutable attempt. It records a pinned source revision and attempt number. Intake without an authoritative source revision is not promoted to V1 and cannot enter the V1 execution path. A rerun creates a child attempt with `rootWorkflowRunId`, `parentWorkflowRunId`, a required reason, and an idempotency key. It never reopens or rewrites the parent. One atomic execution claim permits at most one sandbox execution path per attempt, and sandbox-execution persistence independently rejects a second execution.

### Candidate subject

The repository is prepared at the pinned source SHA. The candidate is frozen after agent execution and before verification. It is identified by:

- the V1 workflow attempt;
- the producing sandbox execution;
- `baseSha`, which must equal the pinned source SHA; and
- `candidateDigest`, currently `sha256:` over the exact captured diff.

A commit `headSha` may additionally identify a materialized candidate, but it cannot substitute for the diff digest while the candidate exists only in a sandbox.

### Requirements and results

Verification requirements are trusted inputs and are persisted before repository preparation or provider execution. A provider result cannot invent or weaken a requirement. Every verification result names its requirement, candidate, provider, command, platform, architecture, outcome, timing, produced artifacts, and candidate digest before/after execution. Candidate mutation or digest mismatch invalidates the result.

Required evidence is complete only when every declared required requirement has a current candidate-bound passing result and all required artifact kinds. Missing, blocked, errored, stale, truncated, unavailable-platform, or mismatched evidence fails closed as incomplete/manual review.

### Review, policy, and human decision

External review, independent verification, and policy are distinct. Policy evaluates one coherent evidence snapshot and persists its version, SHA-256 input digest, considered verification-result IDs, missing requirement IDs, candidate ID, and review ID.

A human decision is valid only for the displayed execution/candidate/review/policy projection. Approval with incomplete verification requires an explicit override reason. The override changes the human-decision dimension, not the verification facts.

### Report and publication

Patch Report V1 is a deterministic projection over durable normalized records plus immutable artifact metadata. Legacy workflows are not silently projected as V1. Trust-critical truncation makes the report incomplete.

PatchPlane retains immutable attempts, evidence, decisions, publication rows, and provenance. External GitHub publication is canonical: one stable issue-comment identity per root workflow, updated on replay, and one candidate-commit-bound check identity. A check is never attached to the original PR head when the candidate is not materialized there. Publication dispatch uses an atomic, leased claim to prevent concurrent duplicate side effects while permitting recovery.

### Supersession

A newer child attempt may supersede an older attempt in the canonical external view, but it does not rewrite old evidence or decisions. Candidate A evidence and approval never apply to candidate B.

## Consequences

- The report can say “verification incomplete — human review required” without blocking useful investigation.
- Native/platform-specific checks remain explicit gaps until a safe matching provider runs them.
- Convex is normalized workflow/provenance truth; R2 stores raw artifacts; telemetry is not provenance.
- Reruns cost a new attempt and sandbox rather than mutating history.
- Broad CI orchestration, requirement inference, signing, and attestations remain out of scope for alpha.

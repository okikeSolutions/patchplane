# ADR 0001: Attempt, candidate, evidence, and supersession identity

- Status: Accepted
- Date: 2026-07-25
- Amended: 2026-07-27 — alpha subject corrected to the exact incoming PR candidate

## Context

PatchPlane must answer whether one specific AI-generated patch has earned human trust. For GitHub pull-request intake, the patch under review already exists and is identified by the PR's exact base and head. Asking Pi to produce another diff does not verify that incoming patch. Provider success signals are also insufficient: Pi exit `0` only completes agent execution, a captured diff is not independent verification, and external-review confidence is not a test result. Reruns and publication retries make “latest row wins” unsafe.

## Decision

### Attempt

A V1 `WorkflowRun` is one immutable attempt. For GitHub PR intake it records authoritative base and head revisions plus an attempt number. Intake without both revisions is not promoted to V1 and cannot enter the V1 execution path. A rerun creates a child attempt with `rootWorkflowRunId`, `parentWorkflowRunId`, a required reason, and an idempotency key. It never reopens or rewrites the parent. One atomic orchestration claim permits one dispatcher for an attempt. The trusted plan may declare a bounded set of execution groups, such as separate Linux and Windows sandboxes. Each group has a stable identity and idempotent execution claim; persistence rejects a duplicate for the same group, not every second sandbox for the attempt.

### Candidate subject

For the alpha GitHub path, the candidate is the incoming PR patch and is frozen before any sandbox, agent, review, or verification execution. It is identified by:

- the V1 workflow attempt and repository/PR identity;
- the webhook-authenticated `baseSha` and `headSha`;
- the exact captured `baseSha...headSha` diff artifact; and
- `candidateDigest`, `sha256:` over those exact captured diff bytes.

The candidate record and artifact must exist before dispatch. Every checkout must resolve to `headSha`, and verification must reproduce the frozen candidate digest before and after each requirement. A producing sandbox execution is required only for a separately modeled sandbox-generated candidate; it is not part of the incoming PR candidate identity and cannot be substituted for it.

### Requirements and results

Verification requirements are trusted inputs and are persisted before candidate freeze, repository preparation, or provider execution. A provider result cannot invent or weaken a requirement. Every verification result names its requirement, candidate, provider, command, platform, architecture, outcome, timing, produced artifacts, and candidate digest before/after execution. Candidate mutation or digest mismatch invalidates the result.

Required evidence is complete only when every declared required requirement has a current candidate-bound passing result and all required artifact kinds. Missing, blocked, errored, stale, truncated, unavailable-platform, or mismatched evidence fails closed as incomplete/manual review.

### Review, policy, and human decision

Read-only external review, independent verification, and policy are distinct. Review starts after candidate freeze and cannot modify the candidate. Policy evaluates one coherent evidence snapshot and persists its version, SHA-256 input digest, considered verification-result IDs, missing requirement IDs, candidate ID, and review ID.

A human decision is valid only for the displayed execution/candidate/review/policy projection. Approval with incomplete verification requires an explicit override reason. The override changes the human-decision dimension, not the verification facts.

### Report and publication

Patch Report V1 is a deterministic projection over durable normalized records plus immutable artifact metadata. Legacy workflows are not silently projected as V1. Trust-critical truncation makes the report incomplete.

PatchPlane retains immutable attempts, evidence, decisions, publication rows, and provenance. External GitHub publication is canonical: one stable issue-comment identity per root workflow, updated on replay, and one candidate-commit-bound check identity attached only to the exact candidate `headSha`. Publication dispatch uses an atomic, leased claim to prevent concurrent duplicate side effects while permitting recovery.

### Supersession

A newer child attempt may supersede an older attempt in the canonical external view, but it does not rewrite old evidence or decisions. Candidate A evidence and approval never apply to candidate B.

## Consequences

- The report can say “verification incomplete — human review required” without blocking useful investigation.
- Native/platform-specific checks remain explicit gaps until a safe matching provider runs them.
- Convex is normalized workflow/provenance truth; R2 stores raw artifacts; telemetry is not provenance.
- Reruns cost a new attempt and its declared bounded execution groups rather than mutating history.
- Sandbox-generated patch creation is implementation foundation, not the alpha GitHub verification subject.
- Broad CI orchestration, requirement inference, synthetic-merge verification, signing, and attestations remain out of scope for alpha.

# Patchplane review guide

Use this as a risk-based checklist. The goal is evidence proportionate to the
change, not a ritual of running unrelated credentialed checks.

## Every change

- The change has a clear owner boundary and does not introduce forbidden imports.
- Types, schemas, and errors remain Patchplane-owned at service boundaries.
- Tests cover the behavior being changed; a regression is encoded when possible.
- `bun run verify` passes, including production-build and bundle budgets.
- Configuration, documentation, and acceptance claims match the implementation.
- The diff contains no secrets, generated local state, logs, or temporary files.

## Trust, security, and provider changes

- External input is verified and decoded before it enters core workflows.
- Authorization occurs at the server/control-plane boundary and uses the
  authenticated workspace and actor, not client-supplied identifiers.
- Provider SDK objects and raw provider payloads do not cross into core or UI
  state. Core receives Patchplane-owned contracts.
- Sandbox input contains no long-lived control-plane credentials. Sandbox output
  is treated as untrusted until normalized and evidenced.
- Telemetry and analytics contain no raw code, diffs, secrets, or evidence
  payloads, and never become workflow truth.

## Workflow, evidence, and publication changes

- The patch remains untrusted until execution, evidence, review, and policy
  preconditions are satisfied.
- Evidence artifacts retain their hash, storage reference, and provenance link.
- Retries are idempotent and cannot duplicate GitHub publication.
- Cancellation, failure, and cleanup leave an understandable timeline and do
  not leak a sandbox or credentials.
- A user-facing Patch Report still answers: what changed, what ran, what passed
  or failed, what evidence exists, and what decision was made.

## Client, Worker, and infrastructure changes

- Server-only modules and secrets do not appear in the client bundle.
- The client never accepts raw sandbox, session, or command identifiers as an
  authority boundary.
- UI copy does not imply a verification result that the system cannot prove.
- Infrastructure changes remain in `apps/infra`; runtime code does not import
  provisioning APIs.
- Cloudflare/Worker route changes have focused tests and, when appropriate, a
  scheduled or release-time credentialed smoke result.

## Validation record

PRs should state the commands run, their results, and why any relevant live
check was not run. A failed automation is a release blocker until it is fixed,
explicitly quarantined with an owner and expiry, or removed because the policy
it enforced is obsolete.

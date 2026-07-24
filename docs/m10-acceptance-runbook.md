# M10 acceptance runbook

This runbook is the repeatable acceptance procedure for the M10 evidence-backed
decision and GitHub publication loop. It separates the automated, credentialed
pre-decision run from the authenticated human decision that must remain a real
trust-boundary pause.

The current smoke automates intake through review readiness, verifies the
durable post-decision state against GitHub, and can actively replay publication
from the same durable human decision. It does **not** authenticate as a WorkOS
user or choose a decision.

## Safety and evidence handling

- Use only a maintainer-controlled test repository and an open test pull
  request. The GitHub App must already be installed for that repository.
- Keep credentials in `.env.local` or deployed secret stores. Never put a
  credential in this document, a command line, a transcript, a PR, or a review
  comment.
- Do not run `env`, `printenv`, `set`, `cat .env.local`, shell tracing
  (`set -x`), or commands that interpolate secret values into output.
- The commands below name environment variables but never their values.
- Treat downloaded diffs, logs, screenshots, Pi output, and sandbox output as
  untrusted evidence. Do not execute an artifact locally.
- Store local transcripts only under `.patchplane/logs/`. Review them before
  sharing: they contain repository names, pull-request numbers, workflow IDs,
  and URLs, but should never contain credential values.

## 1. Preconditions

Use the release-candidate checkout and matching deployed client,
source-control Worker, Convex functions, R2 binding, and model/sandbox
configuration. The operator needs:

- a valid WorkOS session in the deployed client for the workflow workspace;
- `workspace:view` plus `decision:approve` for approval, or `decision:reject`
  for rejection and request-changes;
- local GitHub App configuration (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, and
  `GITHUB_WEBHOOK_SECRET`);
- `CONVEX_URL` or `VITE_CONVEX_URL` and
  `PATCHPLANE_SYSTEM_INGESTION_SECRET`;
- `PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME` and, when needed,
  `PATCHPLANE_SMOKE_PULL_REQUEST_NUMBER`;
- either `PATCHPLANE_TRUST_LOOP_WEBHOOK_URL`, or the Cloudflare lookup inputs
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`;
- working deployed Daytona, R2, Pi provider/model, GitHub routing, and evidence
  configuration. These belong in deployment configuration, not sandbox input.

Use the CLI-owned environment check and fail-closed trust-loop preflight. They
validate configuration names and shapes without contacting providers or
printing values; neither proves deployed providers are reachable:

```sh
bun run patchplane env check --surface githubWebhook
bun run smoke:preflight:trust-loop
```

If the target PR is not set explicitly, the smoke selects the first open PR
returned by GitHub. Set `PATCHPLANE_SMOKE_PULL_REQUEST_NUMBER` in `.env.local`
for a deterministic run. Do not accept a run if the structured
`repositoryFullName` and `pullRequestNumber` identify the wrong target.

## 2. Non-credentialed release gate

Run the complete repository gate before consuming provider resources:

```sh
bun install --frozen-lockfile
bun run verify
bun run format:check
```

Expected result: every command exits zero. `bun run verify` covers typecheck,
lint, local tests, CLI evaluation, the production client build, and client
bundle budgets. Stop on failure; a live run does not waive the local gate.

The standalone Daytona/Pi/R2 check is useful when the release candidate changed
runtime composition or provider configuration:

```sh
bun run smoke:daytona-rpc
```

When artifact capture is enabled in `.env.local`, the final
`rpc_smoke_summary` must report all of the following as `true`:

- `sessionStarted`, `getStateResponse`, `promptResponse`, and
  `hasRuntimeEvents`;
- `steerSent`, `steerResponse`, `followUpSent`, `followUpResponse`,
  `abortSent`, and `abortResponse`;
- `terminated`, `sandboxDeleted`, and `artifactVerified`.

A successful artifact check also emits `artifact_verified` with `deleted: true`,
and cleanup emits `sandbox_cleanup` with `status: "deleted"`.

To encode the real AuthKit and Connect GitHub browser journey, an operator may
run the opt-in headed helper before starting the trust loop:

```sh
PATCHPLANE_LIVE_BROWSER_TEST=true \
PATCHPLANE_PUBLIC_APP_URL=https://<deployed-client-host> \
  bun run smoke:browser
```

The helper uses a local persistent browser profile under `.patchplane/state/`,
requires interactive human pauses, and never accepts credentials as arguments.
It is release evidence only after the operator completes the real provider
screens; it is not part of ordinary CI.

## 3. Start the deployed trust loop

Create a local evidence transcript without exposing the environment:

```sh
mkdir -p .patchplane/logs
set -o pipefail
bun --env-file=.env.local run smoke:trust-loop \
  | tee .patchplane/logs/m10-trust-loop-pre-decision.jsonl
```

The smoke sends a signed synthetic `pull_request.synchronize` delivery for the
real test PR. The requested patch exists only in the Daytona checkout; the
smoke does not push it to the repository.

Expected structured states, in order:

1. `trust_loop_started` identifies `repositoryFullName`,
   `pullRequestNumber`, `deliveryId`, and the deployed `webhookUrl`.
2. The webhook returns HTTP 202 and the workflow reaches
   `workflowStatus: "reviewed"` in the acceptance snapshot.
3. The smoke internally requires:
   - at least one persisted sandbox execution;
   - normalized runtime events;
   - a `captured` candidate patch;
   - a `completed` review run;
   - at least one policy decision;
   - provenance events; and
   - a non-empty `diff` artifact with a lowercase 64-character SHA-256.
4. GitHub contains a new comment beginning `## PatchPlane Patch Report`.
5. `trust_loop_review_ready` reports the `workflowRunId`, `sandboxStatus`,
   `hasRuntimeEvents: true`, a positive `artifactCount`,
   `hasProvenanceEvents: true`, and the Patch Report `publicationUrl`.

Save the `workflowRunId`. Before a human decision, the command intentionally
emits `trust_loop_human_decision_required`, followed by a
`trust_loop_summary` with `completion: "human-decision-required"`, and exits
non-zero. That is the required pause, not an M10 failure. Do not continue if
`trust_loop_review_ready` was not emitted.

`hasRuntimeSessions` may be `false`: the hosted trust loop uses Pi JSON mode by
default. RPC-session persistence is independently covered by
`smoke:daytona-rpc`.

## 4. Authenticated human-decision pause

**STOP AUTOMATION HERE.** A signed-in human must inspect the Patch Report and
make the decision. Neither the system-ingestion secret nor the smoke script may
stand in for WorkOS authorization.

Open the deployed route in the already authenticated browser:

```text
/app/workflows/<workflowRunId>
```

Confirm that the route is in the expected workspace and review, at minimum:

1. repository, PR, prompt, and actor provenance;
2. sandbox status, command, exit code, and lifecycle/network policy;
3. candidate diff and its persisted evidence link/hash;
4. test/log evidence and any browser evidence that is present;
5. automated review findings and policy result; and
6. the pending trust state. Before the decision it should be `Needs review`,
   or `Sandbox failed` when the recorded execution failed—not `Approved`.

Choose exactly one action and enter a non-empty rationale that describes the
observed evidence:

- **Approve** only when the evidence justifies trust;
- **Request changes** when remediation is required; or
- **Reject** when the patch must not proceed.

Expected durable/UI state is respectively `Approved`, `Changes requested`, or
`Rejected`. GitHub must receive a `## PatchPlane Decision Update` comment and a
completed `PatchPlane Review` check. Its conclusion is:

| Human decision              | Expected check conclusion |
| --------------------------- | ------------------------- |
| approved, sandbox succeeded | `success`                 |
| approved, sandbox failed    | `failure`                 |
| changes requested           | `action_required`         |
| rejected                    | `failure`                 |

Do not click a second decision button to test retry: that creates a new
idempotency key and therefore a new durable decision. The replay command in
section 6 reuses the existing durable decision without bypassing this human
authentication boundary.

## 5. Verify the decision

Run the existing post-decision verifier with the saved non-secret workflow ID:

```sh
PATCHPLANE_SMOKE_WORKFLOW_RUN_ID=<workflowRunId> \
  bun --env-file=.env.local run smoke:trust-loop \
  | tee .patchplane/logs/m10-trust-loop-post-decision.jsonl
```

Expected result: exit zero and one `trust_loop_complete` object. It must contain:

- the same `workflowRunId`;
- `humanDecisionId` and `humanDecisionStatus` matching the authenticated
  decision; and
- `publicationResults` with published results whose `externalId` and
  decision-derived `idempotencyKey` are present.

For a PR with both publication targets, the verifier requires published
`issue-comment` and `check-run` entries and reads GitHub directly. The exact
comment marker and check-run `external_id` must each resolve to one GitHub
object whose ID matches the durable publication result. The command also
rechecks all pre-decision evidence assertions.

## 6. Replay without duplicate publication

Replay publication from the **same durable human decision**, not a new UI
decision:

```sh
PATCHPLANE_SMOKE_WORKFLOW_RUN_ID=<workflowRunId> \
PATCHPLANE_SMOKE_REPLAY_PUBLICATION=true \
  bun --env-file=.env.local run smoke:trust-loop \
  | tee .patchplane/logs/m10-trust-loop-replay.jsonl
```

The smoke loads a narrow, system-secret-protected Convex replay fixture,
decodes it through PatchPlane-owned schemas, and reissues the exact decision
idempotency keys through the GitHub provider plugin. The adapter must reconcile
to the existing comment marker and check-run `external_id`; it must not create
new objects. The smoke never calls the authenticated human-decision mutation
and never accepts a replacement decision payload.

Expected replay result:

- `trust_loop_publication_replayed` contains the same human-decision ID;
- `externalIdsUnchanged` is `true`;
- exactly one matching GitHub comment and check run remain for the decision;
- durable publication IDs and GitHub IDs are unchanged before and after replay;
- `trust_loop_complete` reports `replayed: true`; and
- `trust_loop_summary` reports `completion: "publication-replayed"`,
  `automatedChecksComplete: true`, and `requiresHumanUiReadback: true`.

The smoke deliberately keeps `m10Complete: false`: after replay, run the headed
browser helper with the same workflow ID:

```sh
PATCHPLANE_LIVE_BROWSER_TEST=true \
PATCHPLANE_PUBLIC_APP_URL=https://<deployed-client-host> \
PATCHPLANE_SMOKE_WORKFLOW_RUN_ID=<workflowRunId> \
PATCHPLANE_SMOKE_EXPECTED_DECISION=<approved|rejected|changes-requested> \
  bun run smoke:browser
```

The helper first verifies that the connected-repository dashboard identifies
the same workflow as its latest verification and shows the expected decision
status. It then navigates to the authenticated investigation route, checks the
visible decision status, opens the normalized Raw readback, and verifies the
workflow ID, latest decision, and correlated published external IDs. It then
requires the operator to inspect the evidence and type `confirm`. Retain
`browser_acceptance_dashboard_verification_asserted`,
`browser_acceptance_workflow_readback_asserted`, and
`browser_acceptance_workflow_readback_confirmed` with the acceptance evidence.
Automation verifies durable consistency; the explicit operator confirmation
retains human judgment about whether the UI is understandable and correct.

Without `PATCHPLANE_SMOKE_REPLAY_PUBLICATION=true`, post-decision mode verifies
readback only and must not be cited as replay evidence.

## 7. Diagnosis

| Last observed state or error                                   | Likely boundary                     | Action                                                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI reports a required variable                                | Local configuration                 | Run the CLI env check and add the named key to `.env.local` without printing its value.                                                                                      |
| No `trust_loop_started`                                        | Local GitHub/Cloudflare setup       | Check variable names, GitHub App installation, target `owner/repo`, and open PR selection.                                                                                   |
| `trust_loop_started`, then HTTP/non-202 failure                | Worker routing or webhook execution | Use the delivery ID and trace context in Worker/Convex logs; verify the deployed Worker and backend match the checkout. Never paste the signed payload or secrets.           |
| No persisted sandbox execution                                 | Daytona/config/lifecycle            | Inspect redacted telemetry and provider console; remove any orphaned sandbox after recording its ID.                                                                         |
| Missing runtime events                                         | Pi/model path                       | Check deployed provider/model configuration and run `bun run smoke:daytona-rpc`. JSON mode may omit a runtime session but must not omit runtime events.                      |
| Candidate patch not `captured` or diff empty/hash invalid      | Agent/diff/evidence path            | Inspect the untrusted sandbox logs and prompt result; verify R2 binding and clone-base diff capture. Do not approve.                                                         |
| Review not `completed` or policy absent                        | Review/policy persistence           | Inspect Convex/Worker logs by workflow/trace ID. Do not create a human decision by direct database mutation.                                                                 |
| Decision control disabled or authorization error               | WorkOS identity/membership          | Verify the browser session, selected organization, mirrored membership, and required decision permission. Do not use the system-ingestion secret.                            |
| UI records a decision but publication fails                    | GitHub access or publication path   | Preserve the same browser request/idempotency key and replay it after correcting access. Do not click a fresh decision button.                                               |
| Verifier says no correlated durable publication                | Decision/publication persistence    | Inspect `humanDecisionId`, `humanDecisionStatus`, and `publicationResults` in the structured verifier output; require a published external ID keyed by the same decision ID. |
| Replay changes external IDs or creates duplicate GitHub output | Idempotency regression              | Mark M10 failed, retain evidence, and stop release acceptance.                                                                                                               |

## 8. Cleanup and acceptance record

The hosted run should tear down its Daytona sandbox through the workflow
lifecycle. Confirm no test sandbox remains; if one is orphaned, delete that
specific sandbox through the Daytona provider after recording the cleanup.
Do not destroy shared Cloudflare, Convex, GitHub App, or WorkOS resources.

The candidate patch is sandbox-only, so no branch reset is expected. For a
dedicated test PR, close it after evidence review according to repository
policy. Keep GitHub comments/checks and Convex provenance as acceptance
evidence. R2 evidence should expire under its configured short-lived retention
policy; do not manually delete release evidence unless that policy requires it.

Record, without secrets:

- release-candidate commit;
- date and operator identity;
- repository and PR number;
- workflow run ID;
- chosen decision and rationale;
- pre-decision, post-decision, and replay command outcomes;
- matching GitHub comment/check external IDs;
- sandbox cleanup result; and
- any retained artifact policy/expiry.

After the acceptance record has been retained elsewhere, sign out in the
headed acceptance browser and remove its local session profile. Then remove
local transcripts:

```sh
rm -rf .patchplane/state/live-browser-acceptance
```

Local transcripts may be removed with:

```sh
rm -f \
  .patchplane/logs/m10-trust-loop-pre-decision.jsonl \
  .patchplane/logs/m10-trust-loop-post-decision.jsonl \
  .patchplane/logs/m10-trust-loop-replay.jsonl
```

M10 passes only when the complete gate is green, the review-ready pause was
observed, an authenticated human decision was persisted, GitHub publication
readback succeeded, replay produced no duplicate output, and live resources
were cleaned up or retained under an explicit short-lived evidence policy.

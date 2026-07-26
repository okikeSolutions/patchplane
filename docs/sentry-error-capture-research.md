# Sentry error capture and breadcrumb research

This note evaluates Sentry against PatchPlane's alpha critical path. It is
research and implementation guidance, not provenance, release evidence, or a
replacement for [`docs/critical-path.md`](./critical-path.md),
[`docs/telemetry-data-policy.md`](./telemetry-data-policy.md), or the acceptance
matrix.

## Executive conclusion

PatchPlane has a sound deny-by-default sanitizer and several foundational error
capture paths, but it does **not** yet meet the missing M7.5 claims for
critical-path breadcrumbs, capture-once behavior, transport-boundary privacy,
or release/environment identification.

The highest-priority gaps are:

1. no PatchPlane API or production call site creates critical-path breadcrumbs;
2. current sanitization collapses stage and operation values, so even a future
   breadcrumb would not identify which critical-path stage failed;
3. Sentry's current JavaScript data-collection defaults require explicit opt-out
   configuration in addition to `sendDefaultPii: false`;
4. expected product outcomes are not classified consistently before capture;
5. source-control Worker failures do not have one uniform request-scoped capture
   boundary;
6. browser and Worker SDKs hard-code `development` and do not set a release;
7. tests stop at sanitizer/unit mocks rather than inspecting SDK
   transport-bound envelopes.

Sentry should remain an operational locator: one actionable issue for an
unexpected failure, carrying safe IDs and a short ordered stage trail. Convex
and R2 remain the only workflow/provenance and raw-evidence stores.

## What Sentry breadcrumbs are

A breadcrumb is buffered scope context attached to a later event. It does not
create an issue by itself and is not durable workflow truth. JavaScript SDKs
record automatic browser breadcrumbs for navigation, requests, console calls,
and UI interactions, and callers can add manual breadcrumbs with
`Sentry.addBreadcrumb`. `beforeBreadcrumb` can modify or drop each breadcrumb.

Relevant SDK behavior:

- supported fields are `type`, `category`, `message`, `level`, `timestamp`, and
  `data`;
- `beforeBreadcrumb` may return `null` to drop a breadcrumb;
- the default maximum is 100 breadcrumbs, while oversized event envelopes can
  be dropped;
- breadcrumbs live on scopes, and framework integrations normally fork scopes
  around requests;
- `withScope` is appropriate for narrow event-local context;
  `withIsolationScope` is appropriate for request/job isolation when a
  framework does not provide it;
- Sentry's default dedupe integration only compares certain event stack traces
  and fingerprints. It is not a substitute for PatchPlane capture ownership.

For PatchPlane, breadcrumbs are useful only if they are emitted and captured in
the same request/job isolation scope. Global breadcrumbs in a concurrent Worker
or long-lived runtime risk cross-workflow contamination.

## Current repository state

### Existing capture paths

| Surface                                                  | Current mechanism                                                                                      | Assessment                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Browser uncaught errors                                  | TanStack/React SDK global handlers                                                                     | Foundational path exists.                                                                                          |
| TanStack Router error component                          | `Sentry.captureException` in `apps/client/src/router.tsx`                                              | Correct manual capture for a caught boundary error.                                                                |
| TanStack server functions/requests                       | Sentry global middleware plus `wrapFetchWithSentry`; Effect handler also calls `captureTelemetryCause` | Coverage exists, but capture ownership and expected-error classification need tests.                               |
| Client Cloudflare Worker                                 | `withCloudflareSentry` around the Worker handler                                                       | Request wrapper exists.                                                                                            |
| Source-control webhook                                   | `captureTelemetryCause` after a failed Effect exit                                                     | One explicit path exists.                                                                                          |
| Other source-control routes and uncaught Worker failures | Responses/logging vary by route; the Worker itself is not wrapped with `@sentry/cloudflare`            | Coverage is inconsistent.                                                                                          |
| Effect operations                                        | `@sentry/effect` layer, tracer, optional logger/metrics, and `TelemetryService.captureError`           | Integration follows the SDK's Effect v4 composition model, but `@sentry/effect` is alpha and needs boundary tests. |

All configured SDK paths use the shared event, transaction, breadcrumb, log,
metric, and span sanitizers. Attachments are removed in event hooks. These are
strong foundations.

### Breadcrumb state

There are no production `Sentry.addBreadcrumb` calls and `TelemetryService`
has no breadcrumb capability. `recordEvent` writes a Sentry log, not a
breadcrumb, and logs are normally disabled. Therefore the acceptance claim
that issues include bounded critical-path stage breadcrumbs is currently
correctly marked `Missing`.

The sanitizer recognizes `criticalPathStage`, `stage`, and `status`, but it
replaces valid values with generic constants such as `patchplane.stage`. It
also changes every valid PatchPlane breadcrumb category/message to
`patchplane.event` and every operation to `patchplane.operation`. This prevents
an issue from distinguishing intake, sandbox provisioning, candidate capture,
verification, decision, and publication.

### Error actionability

The event sanitizer safely removes arbitrary exception messages and source
context, but it also normalizes every exception type to `Error`, every function
to `patchplane.frame`, modules to `patchplane.module`, and paths to `/:path`.
Line and column numbers remain. This is safe but can make issue titles, grouping,
and diagnosis too generic unless release-specific source maps and a safe typed
error/category survive.

A better balance is an explicit allowlist of PatchPlane-owned typed error codes
or classes plus normalized application module identifiers. Raw provider
messages, arbitrary exception values, local variables, and source context must
remain prohibited.

### Data collection and configuration

Current Sentry JavaScript documentation says `sendDefaultPii` is deprecated for
v11 and recommends `dataCollection`. Supplying `dataCollection` opts into its
rich defaults unless every category is explicitly restricted. Current defaults
can include user information, cookies, HTTP headers and bodies, URL query
parameters, generative-AI inputs/outputs, stack-frame variables, and source
context.

PatchPlane's `beforeSend` sanitizer strips these fields from ordinary events,
but each SDK should also configure collection off at the source:

```ts
dataCollection: {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  queryParams: false,
  genAI: { inputs: false, outputs: false },
  stackFrameVariables: false,
  frameContextLines: 0,
}
```

Keep `sendDefaultPii: false` while SDK v10 is supported, then treat the explicit
`dataCollection` policy as the forward-compatible control. The exact option
shape must be type-checked against the pinned SDK version before implementation.

The browser and Cloudflare wrapper currently hard-code `environment:
'development'` and `tracesSampleRate: 1`. No release is configured. The
source-control and client infra environments also provision development values.
This directly explains the missing environment/release acceptance row and is
unsafe as a production default.

The repository uses exact `10.62.0` Sentry dependencies in app/plugin manifests,
but the root `@sentry/effect` range has resolved a separate `10.68.0` tree in
`bun.lock`. Sentry packages should use one pinned version to avoid duplicated
SDK cores and scope/client incompatibilities.

## Recommended PatchPlane design

### 1. Add a provider-neutral breadcrumb contract

Extend `TelemetryService` with a best-effort operation such as
`addBreadcrumb`. Core should depend only on PatchPlane-owned types. The input
should not accept arbitrary nested data:

```ts
type CriticalPathStage =
  | 'request-authorization'
  | 'source-pinning'
  | 'attempt-claim'
  | 'requirements-persisted'
  | 'sandbox-execution'
  | 'candidate-frozen'
  | 'verification'
  | 'review-policy'
  | 'report-assembled'
  | 'human-decision'
  | 'rerun-created'
  | 'publication'
  | 'release-readback'

type CriticalPathBreadcrumb = {
  stage: CriticalPathStage
  status: 'started' | 'succeeded' | 'failed' | 'blocked'
  traceId?: string
  workflowRunId?: string
  // Other IDs only from the telemetry policy allowlist.
  errorCategory?: string
  durationMs?: number
}
```

The Sentry plugin can map this to category `patchplane.critical-path`, a stable
allowlisted message such as `patchplane.<stage>.<status>`, and allowlisted data.
The no-op plugin remains no-op.

Use literal schemas/enums for stage, status, operation, plugin, and typed error
category. Do not accept a free-form breadcrumb message.

### 2. Emit bounded breadcrumbs at durable transitions

Use the 13 stages in `docs/critical-path.md` as the vocabulary. Emit at most a
`started` and terminal breadcrumb for a stage, and do not breadcrumb individual
Pi events, commands, files, logs, findings, or artifact contents.

Useful points are after PatchPlane has normalized the input or persisted the
transition:

- request authenticated/rejected;
- source SHA pinned;
- immutable attempt created/reused and execution claimed;
- trusted verification requirements persisted;
- sandbox provision/execute/cleanup terminal state;
- candidate frozen with safe IDs only;
- verification terminal coverage;
- review/policy snapshot recorded;
- report assembled;
- human decision recorded;
- child rerun created;
- canonical publication completed/failed;
- release smoke readback completed.

A breadcrumb is supporting context only. The same transition still belongs in
Convex provenance and, where applicable, R2 evidence.

Set `maxBreadcrumbs` to the same explicit bound enforced by the sanitizer
(currently 64). Preserve the most recent bounded transitions.

### 3. Establish capture ownership and classification

Define one owner for each failure:

- framework/request boundary captures an exception that escapes;
- a core/application boundary manually captures an Effect failure only when it
  converts that failure into a response and therefore prevents escape;
- provider code enriches and rethrows/returns typed errors, but does not capture
  the same failure again;
- background jobs get their own isolation scope and top-level capture owner.

Do not rely on Sentry's dedupe integration for this rule.

Create a mechanically tested classifier:

| Outcome                                                                                                 | Default telemetry action                 |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| malformed input / schema rejection                                                                      | no issue; optional metric/log            |
| authorization denial                                                                                    | no issue                                 |
| duplicate webhook / execution claim lost                                                                | no issue                                 |
| idempotent publication replay                                                                           | no issue                                 |
| policy rejection / human rejection                                                                      | no issue                                 |
| incomplete or blocked evidence                                                                          | no issue                                 |
| expected provider unavailability represented in product state                                           | no issue unless an invariant also failed |
| persistence invariant, unexpected provider defect, cleanup defect, impossible state, uncaught exception | capture one issue                        |

If an expected outcome exposes an invariant violation, capture the invariant
error category, not the raw expected error.

### 4. Preserve safe diagnostic value

Each unexpected issue should retain:

- environment and release;
- safe typed error category/code;
- safe operation and critical-path stage literals;
- trace and matching attempt/candidate/publication IDs as applicable;
- stack frame line/column and a safe application-module identity;
- ordered bounded breadcrumbs;
- trace/span IDs when tracing is sampled.

Do not include prompts, diffs, commands, stdout/stderr, webhook bodies, provider
responses, artifact bodies, user identity, repository names, branch names, URL
paths, query parameters, or secrets.

Use tags only for low-cardinality fields such as environment, stage, operation,
plugin, and error category. Keep high-cardinality correlation IDs in structured
context rather than indexed tags unless Sentry query needs are measured and
approved.

### 5. Isolate scopes

- Browser: page-level automatic scope is acceptable; use `withScope` for
  event-local capture context.
- Cloudflare request handlers: use the official `withSentry` request wrapper so
  each request receives SDK isolation.
- Source-control/background Effect work: explicitly establish one isolation
  scope per request/workflow dispatch before adding breadcrumbs.
- Never add workflow breadcrumbs to the global scope.

## Critical-path capture plan

| Critical-path area                                 | Breadcrumb expectation                                   | Issue expectation                                                                    |
| -------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Stages 1-4: intake, source, attempt, requirements  | safe start/terminal state after decoding                 | only unexpected verification/persistence/invariant failures                          |
| Stage 5: sandbox                                   | provision, execution, and cleanup terminal states        | unexpected provider/cleanup defect; ordinary blocked capability stays product state  |
| Stages 6-8: candidate, verification, review/policy | durable ID/status transitions                            | identity mismatch or impossible state; failed checks/policy rejection are not issues |
| Stages 9-10: report and human decision             | assembled and decision-recorded states                   | projection/persistence invariant failure; human rejection is not an issue            |
| Stage 11: rerun                                    | child created/reused                                     | immutable-parent or idempotency invariant failure                                    |
| Stage 12: publication                              | dispatch and terminal publication state                  | unexpected publication defect; replay is not an issue                                |
| Stage 13: release proof                            | deliberate smoke/readback markers using synthetic values | a dedicated deliberate-failure issue linked to the release candidate                 |

## Verification required before changing acceptance status

### Automated contract tests

- `TelemetryService.addBreadcrumb` no-op and Sentry implementations.
- Every critical-path stage/status maps to a stable sanitized value.
- Expected-outcome classifier table tests.
- Capture ownership tests assert zero or one `captureException` call per route
  failure.
- Concurrent request/workflow tests prove breadcrumbs do not cross scopes.

### Transport-bound privacy tests

Use an in-memory/custom SDK transport, not only direct sanitizer calls or a
mocked `captureException`. Exercise browser, TanStack server, Cloudflare Worker,
and Effect SDK initialization. Put a synthetic sentinel into every supported
shape:

- exception/message/cause and stack source context;
- tags, contexts, extra, user, request URL/headers/body/cookies;
- breadcrumb category/message/data and automatic breadcrumbs;
- log attributes, metric attributes, span data/descriptions;
- attachments and provider-like nested values.

Decode the final Sentry envelope and assert no sentinel, request body, original
path/query/fragment, local variable, source excerpt, or attachment remains.
Also assert that allowed release, environment, typed category, stage, status,
and correlation IDs do remain.

### Deployed deliberate-failure smoke

From one release candidate, trigger one non-sensitive deliberate failure on
each supported surface and read it back from Sentry:

1. browser route/error boundary;
2. client Cloudflare Worker;
3. TanStack server function/request;
4. source-control Worker/Effect workflow.

Assert the exact release/environment, one event owner, safe stage trail,
correlation lookup, useful stack/source-map location, and absence of sentinel
content. These results can then support the currently `Missing` M7.5 rows in
`docs/acceptance-tests.md`.

## Recommended implementation order

1. Add explicit `dataCollection` deny configuration and environment/release
   plumbing to every SDK surface.
2. Pin one Sentry SDK version across the workspace.
3. Add the provider-neutral breadcrumb contract and literal sanitizer values.
4. Wrap/isolate the source-control Worker and add stage breadcrumbs at
   application boundaries.
5. Add the expected-outcome classifier and capture-once route tests.
6. Add transport-envelope sentinel tests for all SDK surfaces.
7. Configure source maps without exposing source content in events.
8. Run deployed deliberate-failure readback and only then update acceptance
   status.

## Sources

Official Sentry documentation consulted:

- [TanStack Start manual setup and error capture](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/manual-setup/)
- [Capturing errors](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/usage/)
- [Breadcrumbs](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/enriching-events/breadcrumbs/)
- [Scopes and request isolation](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/enriching-events/scopes/)
- [JavaScript SDK options, including `dataCollection`, hooks, and breadcrumb limits](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/configuration/options/)
- [Cloudflare setup and runtime limitations](https://docs.sentry.io/platforms/javascript/guides/cloudflare/)
- [Effect SDK setup](https://docs.sentry.io/platforms/javascript/guides/effect/)
- [Default dedupe integration](https://docs.sentry.io/platforms/javascript/configuration/integrations/dedupe/)

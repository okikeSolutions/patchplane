# Effect-native architecture boundaries

PatchPlane uses Effect as the default orchestration model. Provider SDKs,
framework callbacks, and web-platform APIs are untrusted boundaries; they do
not justify Promise-based application logic beyond the smallest adapter that
Effect can safely own.

This document is normative. `tests/architecture/effect-boundaries.test.ts`
enforces the mechanically decidable rules.

## Convention

Production orchestration in `packages/`, `apps/source-control/`, and
`apps/infra/` must use Effect wherever the runtime permits it:

- reusable workflows use `Effect.fn` or `Effect.fnUntraced`;
- dependencies use `Context.Service` and `Layer`;
- provider promises enter through `Effect.tryPromise`, passing its
  `AbortSignal` when the provider accepts one;
- synchronous external callbacks enter through `Effect.sync` or `Effect.try`;
- acquisition and cleanup use `Effect.acquireUseRelease`;
- time and deadlines use `Clock`, `Effect.sleep`, schedules, or an Effect race;
- errors use PatchPlane-owned `Schema.ErrorClass`/tagged errors rather than raw
  `Error`, rejected strings, or untyped `unknown` channels;
- request, queue, and command paths use Effect spans and typed failure handling
  before crossing the final runtime bridge;
- tests use `it.effect` and `TestClock` when they exercise Effects.

Pure schemas, refinements, canonicalization, formatting, and deterministic
helpers should remain pure. Importing Effect merely to wrap pure code does not
make a module more Effect-native.

The following are prohibited outside a registered boundary adapter:

- top-level `async` orchestration;
- raw `try`/`catch` around business logic;
- ad hoc `Promise.race`, `new Promise`, or `setTimeout` deadlines;
- multiple nested `Effect.runPromise` calls when one runtime bridge can own the
  request;
- returning an `Effect` object to a framework that expects a Promise.

## Boundary classes and verified behavior

| ID                    | Boundary                                                                    | Native Effect support                                                   | Required adapter                                                                                                                                            | Validation and result                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CF-WORKER-001`       | Cloudflare `fetch`, `queue`, and `scheduled` callbacks                      | No direct return support                                                | Return exactly one `Effect.runPromise(program)` from the framework callback                                                                                 | A local Wrangler Worker returning `Effect.succeed(Response)` returned HTTP 500: “Promise did not resolve to Response.” The same Worker using `Effect.runPromise` returned HTTP 200.                    |
| `CF-BINDING-001`      | R2, Queue, service-binding, and Web `fetch` promises                        | Promise API only                                                        | `Effect.tryPromise`; propagate its signal to APIs accepting `AbortSignal`                                                                                   | Source-control tests cover oversized, stalled, invalid-content-type, and cancellation behavior.                                                                                                        |
| `CF-STREAM-001`       | `ReadableStreamDefaultReader`                                               | Promise API only                                                        | bounded Effect loop; cancellation in an uninterruptible/nonblocking release                                                                                 | `webhook-worker.test.ts` covers bounded request and service-binding response streams.                                                                                                                  |
| `WEB-CRYPTO-001`      | Web Crypto digest/HMAC                                                      | Promise API only                                                        | `Effect.tryPromise` with a PatchPlane-owned boundary error                                                                                                  | Signed-webhook tests exercise valid and invalid signatures. Web Crypto has no AbortSignal parameter, so interruption stops the Effect but cannot cancel the native operation.                          |
| `CONVEX-HANDLER-001`  | Convex query/mutation/action handler return                                 | Direct Effect is not executed                                           | Convex callback must return a value/Promise; an Effect-based handler requires one `Effect.runPromise` bridge                                                | A `convex-test` mutation returning `Effect.succeed("direct")` returned the serialized object `{ "~effect/Effect/args": "direct" }`. Bridging with `Effect.runPromise` returned `"bridged"`.            |
| `CONVEX-CTX-001`      | Convex transactional `ctx.db`, scheduler, query, mutation, and action calls | Promise API owned by Convex transaction runtime                         | Keep the registered handler as the transaction boundary; use an Effect bridge only when the whole handler is migrated and rollback/cancellation tests exist | Existing Convex modules are an explicit framework-boundary inventory, not precedent for Promise orchestration in other packages. New cross-provider orchestration does not belong in Convex mutations. |
| `ALCHEMY-001`         | Alchemy stack declaration                                                   | Yes                                                                     | None: pass an `Effect` directly to `Alchemy.Stack`                                                                                                          | Alchemy 2.0’s `Stack` signature requires `Effect.Effect`; `alchemy.run.ts` and infra typechecks verify the native path.                                                                                |
| `SDK-PROMISE-001`     | Daytona, Octokit, WorkOS, Convex client, and AWS/R2 SDK calls               | Promise API only                                                        | provider plugin wraps calls with `Effect.tryPromise` and maps failures to PatchPlane-owned errors                                                           | Plugin typechecks and provider adapter tests validate each implementation. Provider code remains in `packages/plugins`.                                                                                |
| `SENTRY-CF-001`       | `@sentry/cloudflare` Worker wrapper                                         | Promise callback required                                               | Effect program runs inside the request callback; Sentry wraps only the final Promise bridge                                                                 | `packages/plugins/src/sentry/cloudflare-worker.test.ts` and source-control critical-path tests validate sanitization and capture.                                                                      |
| `NATIVE-DEADLINE-001` | Provider operations used from uninterruptible release/finalizer regions     | Effect interruption alone cannot stop a never-settling provider Promise | PatchPlane-owned native provider deadline inside the Effect adapter, with a documented bounded release                                                      | Daytona and Convex deadline regression tests reproduce never-settling finalizers. This is the only approved `new Promise`/timer class in provider production code.                                     |
| `CLI-RUNTIME-001`     | Bun/Node process entry                                                      | Process requires Promise/exit code                                      | one `Effect.runPromise`/`runPromiseExit` at the executable entry                                                                                            | CLI evaluation and package tests verify the bridge.                                                                                                                                                    |
| `TEST-RUNTIME-001`    | Vitest and provider fakes                                                   | Test framework callback                                                 | use `it.effect`; Promise fakes may implement external SDK interfaces                                                                                        | Architecture checks exclude test doubles from the production-native percentage.                                                                                                                        |

## Owned boundary inventory

### `apps/source-control`

- `apps/source-control/src/worker.ts`: Cloudflare `fetch` bridge
  (`CF-WORKER-001`). It returns the Promise produced by exactly one route
  `ManagedRuntime` bridge, adds only boundary failure capture and disposal
  scheduling, and does not start a second Effect runtime.
- `src/webhook-worker.ts` and `src/webhook-worker/*.ts`: Cloudflare `fetch`,
  `scheduled`, and `queue` bridges split across bounded-input, fetch, recovery,
  primary-delivery, dead-letter, and processing-support modules. Webhook
  verification, R2/Convex/Queue calls, bounded streams, service-binding
  deadlines, retries, and terminalization are Effect programs.
- `src/github/routes.ts` and `src/github/routes/*.ts`: managed-runtime HTTP
  adapters split by endpoint. The exported route functions return Promises
  because Cloudflare consumes them, while core workflows, configuration,
  deadlines, and failures execute in the shared `ManagedRuntime`.
- `src/github/config.ts` and `src/critical-path-telemetry.ts`: native Effect.

No provider SDK implementation belongs in this application directory.

### `apps/infra` and `alchemy.run.ts`

Alchemy is itself Effect-native. Stack provisioning, config decoding, naming,
and filesystem reads remain Effects or pure functions. Cloudflare resource
objects are declarative values, not Promise orchestration. Shell commands in
`apps/infra/package.json` are process-entry adapters only.

### `packages/domain`, `packages/core`, and `packages/cli`

These packages have no approved Promise orchestration boundary:

- domain is PatchPlane-owned schemas, refinements, and types;
- core is provider-agnostic Effect workflows and services;
- CLI commands are Effect programs with one process-entry bridge.

Pure helper modules are allowed and preferred over artificial Effect wrappers.

### `packages/plugins`

Plugins are Effect-native adapters around Promise SDKs. A Promise type in a
provider interface is expected; application orchestration outside
`Effect.tryPromise` is not. The explicit exceptions are:

- native provider deadlines used to bound never-settling Promise operations in
  finalizers (`NATIVE-DEADLINE-001`);
- `packages/plugins/src/sentry/cloudflare-worker.ts`, the Sentry Cloudflare
  higher-order Worker callback (`SENTRY-CF-001`);
- executable live-smoke entrypoints, which have one runtime bridge.

### `packages/backend/convex`

Convex is a verified framework boundary. Returning an Effect directly is a
correctness bug because Convex serializes it. The registered Promise-native
transaction inventory is explicit:

- `packages/backend/convex/auth.ts`
- `packages/backend/convex/connectedRepositories.ts`
- `packages/backend/convex/promptRequests.ts`
- `packages/backend/convex/requests.ts`
- `packages/backend/convex/viewer.ts`
- `packages/backend/convex/workflowRuns.ts`
- `packages/backend/convex/workflowStarts.ts`
- `packages/backend/convex/workflowStarts/candidates.ts`
- `packages/backend/convex/workflowStarts/deliveries.ts`
- `packages/backend/convex/workflowStarts/lifecycle.ts`
- `packages/backend/convex/workflowStarts/readModels.ts`
- `packages/backend/convex/workflowStarts/readModels/publicationFixture.ts`
- `packages/backend/convex/workflowStarts/readModels/recentWorkflows.ts`
- `packages/backend/convex/workflowStarts/readModels/workflowDetail.ts`
- `packages/backend/convex/workflowStarts/reviewPublication.ts`
- `packages/backend/convex/workflowStarts/runtimeEvidence.ts`
- `packages/backend/convex/workflowStarts/shared.ts`
- `packages/backend/convex/workflowStarts/shared/foundation.ts`
- `packages/backend/convex/workflowStarts/shared/integrity.ts`
- `packages/backend/convex/workflowStarts/shared/workflowPersistence.ts`
- `packages/backend/convex/workflowStarts/verification.ts`
- `packages/backend/convex/workflowStarts/verification/executionGroups.ts`
- `packages/backend/convex/workflowStarts/verification/plans.ts`
- `packages/backend/convex/workflowStarts/verification/results.ts`

Existing transaction handlers remain in this inventory while migration is
evaluated handler by handler. An Effect migration is valid only when:

1. the handler has one `Effect.runPromise` bridge;
2. every Convex Promise is wrapped with a typed error;
3. mutation rollback is tested after an Effect failure;
4. interruption/deadline behavior cannot acknowledge work whose transaction
   later commits;
5. scheduled function identity and transaction limits remain unchanged.

This exception does not permit Convex-style `async` code in core, plugins, or
applications.

## Measurement

The automated target is **at least 85% Effect-native eligible production
modules**, measured as follows:

1. Include production TypeScript modules under `packages/`,
   `apps/source-control/`, and `apps/infra/`, plus `alchemy.run.ts`.
2. Exclude tests, generated files, live-smoke/scripts, and declaration files.
3. Classify deterministic modules with no asynchronous orchestration as pure
   and compliant.
4. Classify registered Convex transaction modules and listed framework entry
   callbacks as explicit boundaries.
5. Every remaining orchestration module must import and compose Effect.

The test reports the numerator, denominator, and violations. Boundary modules
are listed rather than silently removed, so the percentage cannot hide an
unreviewed Promise island. The target is a floor, not permission to convert
only 85%; any new eligible orchestration must be Effect-native.

## Adding or changing a boundary

A boundary change is incomplete unless the same change includes:

1. a row in this document with an ID and owner;
2. a compile-time or runtime experiment proving direct Effect support or the
   required bridge;
3. a regression test for success, failure, interruption, and cleanup where
   applicable;
4. an architecture-test classification;
5. Sentry span/error behavior and data-policy review;
6. confirmation that no untrusted provider value entered a PatchPlane-owned
   type without decoding.

If a boundary can accept Effect directly, adapters using raw Promise
orchestration are not allowed. If it cannot, the Promise bridge must be the
smallest possible outer function and all inner work remains Effect-native.

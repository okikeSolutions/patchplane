# Effect-native architecture boundaries

PatchPlane uses Effect as the default orchestration model. Provider SDKs,
framework callbacks, and web-platform APIs are boundaries; they do not justify
Promise-based application logic beyond the smallest adapter Effect can own.

This document is normative. The machine-readable source of truth is
[`config/effect-boundaries.json`](../config/effect-boundaries.json).
`tests/architecture/effect-boundaries.test.ts` verifies exact runtime bridge
counts, registry/document synchronization, referenced evidence, and the narrow
package rules described below. `scripts/oxlint/patchplane-plugin.mjs` rejects
unregistered runtime execution and unsafe Effect Promise constructors.

## Current enforcement status

Runtime bridges are necessary framework/process boundaries with committed
behavioral evidence. A green architecture test means there are no unregistered
runtime calls or registered migration debt. PatchPlane does not publish an
Effect-native module percentage. Pure modules, Effect orchestration, and
framework boundaries are not comparable units for a meaningful percentage.

## Convention

Production orchestration in `packages/`, `apps/source-control/`, `apps/infra/`,
and client server/runtime modules must use Effect wherever the runtime permits
it:

- reusable traced entry programs use named `Effect.fn`; reusable internal
  programs use `Effect.fnUntraced`;
- dependencies use class-style `Context.Service` and `Layer`;
- fallible provider promises use the `{ try, catch }` form of
  `Effect.tryPromise` and map failures to PatchPlane-owned tagged errors;
- the `tryPromise` `AbortSignal` is passed when the provider accepts one;
- Promise-based custom `fetch` callbacks required by provider SDKs stay private
  to plugin adapters; the adapter combines SDK and Effect signals and exposes
  Effect operations rather than the raw SDK client;
- synchronous throwing callbacks enter through `Effect.try`;
- acquisition and cleanup use `Effect.acquireUseRelease`, scoped resources, or
  an equivalent Effect finalizer;
- time and deadlines use `Clock`, `Effect.sleep`, schedules, or an Effect race;
- request, queue, and command programs use named spans and typed failure
  handling before crossing the final runtime bridge;
- Effect tests use `it.effect`/`it.scoped` and `TestClock` where applicable.

Pure schemas, refinements, canonicalization, formatting, and deterministic
helpers remain pure. Importing Effect does not establish compliance.

Outside a registered boundary, production code must not contain:

- `Effect.runPromise`, `runPromiseExit`, `runSync`, or `runSyncExit`;
- `ManagedRuntime` execution calls;
- top-level Promise orchestration;
- raw business-logic `try`/`catch`;
- ad hoc `Promise.race`, `new Promise`, or timer deadlines;
- an Effect returned to a framework expecting a Promise;
- new `switch` statements. Multi-case and discriminated-union branching uses
  `effect/Match`, ending in `Match.exhaustive` when the input union is closed or
  an explicit `Match.orElse` when a runtime fallback is intentional.

Effect V4's `tryPromise` aborts the supplied signal when its fiber is
interrupted, but the native operation stops only if it observes that signal.
`runPromise` and `ManagedRuntime.runPromise` accept a boundary `AbortSignal`.
`acquireUseRelease` makes acquisition and release uninterruptible, so a provider
Promise used by a finalizer also needs a native deadline if it can fail to
settle. These semantics are verified in the vendored Effect implementation and
its interruption tests under `vendor/effect/packages/effect`.

## Boundary classes

| ID                   | Boundary                                               | Required adapter                                                                       |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `CF-WORKER-001`      | Cloudflare `fetch`, `queue`, and `scheduled` callbacks | One runtime Promise bridge at the callback; inner work remains Effect                  |
| `CF-BINDING-001`     | R2, Queue, service binding, and Web `fetch`            | Typed `Effect.tryPromise`; pass the Effect signal where supported                      |
| `CF-STREAM-001`      | `ReadableStreamDefaultReader`                          | Bounded Effect loop and nonblocking release cancellation                               |
| `WEB-CRYPTO-001`     | Web Crypto                                             | Typed `Effect.tryPromise`; native operation is not abortable                           |
| `CONVEX-HANDLER-001` | Convex query/mutation/action handler                   | Convex-native Promise handler; never return an Effect directly                         |
| `CONVEX-CTX-001`     | Convex transaction context calls and helpers           | Await Convex Promises inside the transaction boundary; no cross-provider orchestration |
| `ALCHEMY-001`        | Alchemy stack declaration                              | Pass Effect directly to `Alchemy.Stack`; no Promise adapter                            |
| `SDK-PROMISE-001`    | Provider SDK calls                                     | Plugin-local typed `Effect.tryPromise` adapter                                         |
| `SENTRY-CF-001`      | `@sentry/cloudflare` Worker wrapper                    | Sentry wraps only the final Promise callback                                           |
| `CLI-RUNTIME-001`    | Bun/Node process entry                                 | One runtime bridge at executable entry                                                 |
| `TEST-RUNTIME-001`   | Vitest/provider fakes                                  | `it.effect` for Effect tests; Promise fakes may implement SDK interfaces               |

Convex's Promise-native transaction model is a framework boundary, not
precedent for Promise orchestration in core, plugins, or applications. Convex
helpers may remain ordinary async helpers when they execute only transaction
context operations. Provider calls and cross-provider workflows remain outside
Convex mutations.

## Runtime bridge registry

### Approved boundaries

| ID                             | File                                                                    | Owner                          | Calls | Evidence                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------ | ----: | --------------------------------------------------------------------------- |
| `CLIENT-UI-DIFF-001`           | `apps/client/src/components/app-shell/use-candidate-diff-preview.ts`    | React diff projection callback |     1 | `apps/client/src/components/app-shell/workflow-changes.test.tsx`            |
| `CLIENT-RUNTIME-001`           | `apps/client/src/effect/runtime.ts`                                     | Client Effect runtime adapter  |     1 | `apps/client/src/effect/diff-runtime.test.ts`                               |
| `CLIENT-INSTALL-CALLBACK-001`  | `apps/client/src/routes/api/github/install/callback.tsx`                | GitHub install callback        |     1 | `apps/client/src/routes/api/github/install/-install-flow.test.ts`           |
| `CLIENT-INSTALL-START-001`     | `apps/client/src/routes/api/github/install/start.tsx`                   | GitHub install start           |     1 | `apps/client/src/routes/api/github/install/-install-flow.test.ts`           |
| `CLIENT-ARTIFACT-OPEN-001`     | `apps/client/src/components/app-shell/workflow-artifact-references.tsx` | Artifact opening callback      |     1 | `apps/client/src/components/app-shell/workflow-artifact-references.test.ts` |
| `CLIENT-ARTIFACT-ROUTE-001`    | `apps/client/src/routes/api/artifacts/url.tsx`                          | Artifact URL route             |     1 | `apps/client/src/routes/api/artifacts/-url.test.ts`                         |
| `CLIENT-SERVER-FN-001`         | `apps/client/src/lib/effect-server-fn.ts`                               | `effectServerFn`               |     3 | `apps/client/src/lib/effect-server-fn.test.ts`                              |
| `CLIENT-SIGNIN-001`            | `apps/client/src/routes/api/auth/sign-in.tsx`                           | Sign-in route                  |     1 | `apps/client/src/routes/api/auth/-sign-in.test.ts`                          |
| `CLIENT-STARTUP-001`           | `apps/client/src/start.ts`                                              | TanStack application startup   |     1 | `apps/client/src/lib/server-function-request-bound.test.ts`                 |
| `CLIENT-THEME-001`             | `apps/client/src/lib/theme.ts`                                          | Theme server functions         |     2 | `apps/client/src/components/theme-provider.test.tsx`                        |
| `CLIENT-WORKOS-INITIAL-001`    | `apps/client/src/lib/workos-initial-auth.ts`                            | Initial WorkOS auth            |     1 | `apps/client/src/lib/workos-initial-auth.test.ts`                           |
| `CLIENT-AUTH-CALLBACK-001`     | `apps/client/src/routes/api/auth/callback.tsx`                          | WorkOS callback route          |     1 | `apps/client/src/routes/api/auth/-callback.test.ts`                         |
| `CF-SOURCE-CONTROL-WORKER-001` | `apps/source-control/src/worker.ts`                                     | `runSourceControlEffect`       |     1 | `apps/source-control/src/worker.test.ts`                                    |
| `CF-WORKER-001`                | `apps/source-control/src/webhook-worker.ts`                             | Cloudflare Worker callbacks    |     1 | `apps/source-control/src/webhook-worker.test.ts`                            |

### Async orchestration exceptions

`async` functions directly owned by `Effect.tryPromise({ try })` are provider
adapters and do not enter this inventory. There are no unregistered async
orchestration exceptions in governed client or plugin modules.

## Pattern-matching enforcement

The [Effect pattern-matching guidance](https://www.effect.website/docs/v3/code-style/pattern-matching)
is enforced for production code against the pinned Effect v4 `Match` API. New
`switch` statements are rejected, and `Match.value` / `Match.type` pipelines
must terminate with `Match.exhaustive` or an explicit `Match.orElse` fallback.
The exact switch-debt registry is empty.

## Native deadline exceptions

Native timers are allowed only in these exact adapters. `evidence: null` in the
registry is an explicit missing-evidence finding, not an assertion of coverage.

| ID                                    | File                                                            | Owner                          | Evidence status                                                      |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `NATIVE-DEADLINE-GITHUB-PROVIDER-001` | `packages/plugins/src/github/github-provider-deadline.ts`       | `githubProviderDeadlineSignal` | `packages/plugins/src/github/github-provider-deadline.test.ts`       |
| `NATIVE-DEADLINE-CONVEX-MUTATION-001` | `packages/plugins/src/convex/storage/bounded-native-promise.ts` | `settleConvexMutation`         | `packages/plugins/src/convex/storage/bounded-native-promise.test.ts` |
| `NATIVE-DEADLINE-DAYTONA-001`         | `packages/plugins/src/daytona/daytona-process.ts`               | `settleWithin`                 | `packages/plugins/src/daytona/DaytonaSandboxPlugin.test.ts`          |
| `NATIVE-DEADLINE-DAYTONA-POLICY-001`  | `packages/plugins/src/daytona/daytona-policy.ts`                | provider policy deadline       | `packages/plugins/src/daytona/DaytonaSandboxPlugin.test.ts`          |
| `NATIVE-DEADLINE-DAYTONA-DELETE-001`  | `packages/plugins/src/daytona/DaytonaSandboxPlugin.ts`          | deletion release               | `packages/plugins/src/daytona/DaytonaSandboxPlugin.test.ts`          |

## What automation proves

The architecture and lint suites prove only mechanically decidable properties:

1. every production runtime execution call is registered;
2. each registered file has exactly the declared number of calls or async debt functions;
3. an approved entry has an existing evidence test reference;
4. registry IDs, files, and documentation stay synchronized;
5. domain, core, and CLI contain none of the repository's lexical Promise
   orchestration markers;
6. webhook Worker modules contain no native Promise race/timer deadline;
7. production `Effect.tryPromise` uses an explicit error mapper;
8. Alchemy remains directly Effect-based.

Behavioral evidence must separately cover success, typed failure,
interruption, cleanup, and framework transaction semantics. Static checks do
not prove a provider consumes an AbortSignal or that a finalizer terminates.

## Adding or changing a boundary

A boundary change is incomplete unless it includes:

1. a registry entry with ID, exact file/owner, class, and expected call count;
2. a compile-time or runtime experiment proving direct Effect support or the
   required bridge;
3. regression coverage for success, failure, interruption, and cleanup where
   applicable;
4. architecture and Oxlint fixture coverage;
5. telemetry/error sanitization review;
6. confirmation that external values are decoded before entering
   PatchPlane-owned types;
7. the matching row in this document.

If a boundary accepts Effect directly, raw Promise orchestration is forbidden.
If it cannot, the adapter is the smallest outer function and all inner work
remains one Effect program.

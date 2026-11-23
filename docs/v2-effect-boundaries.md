# V2 Effect boundaries

Accepted architecture contract, 2026-11-22, updated 2026-11-23. Enforcement is required work, not an existing implementation claim. See [ADR 0009](adr/0009-use-foldkit-and-enforce-effect-native-boundaries.md) and [ADR 0010](adr/0010-postgres-single-store-and-cloud-only-verification.md).

## Default

Authored asynchronous application work uses Effect v4 throughout the UI, services, adapters, CLI, MCP, tests, and Alchemy infrastructure. Effect owns typed failures, retries, streams, scoped resources, interruption, and cleanup. Pure synchronous computation and rendering do not need artificial Effect wrappers.

Foldkit owns the standalone Web Decision Inbox model, transitions, and Effect commands/subscriptions, including SSE or WebSocket live updates from the Effect server. React Islands are limited strictly to irreplaceable third-party widgets such as a diff viewer. They receive typed view data and emit typed events, and must not introduce a parallel application store or Promise-based networking, verification, or approval workflows. Local synchronous presentation state is permitted. Authorization remains server-enforced.

Third-party implementation internals may use Promises. That does not authorize Patchplane-authored Promise orchestration. Prefer native Effect integrations, such as `@effect/sql-pg`, `effect/workflow`, `effect/cluster`, and Alchemy Effect bindings like `Daytona.CreateSandbox`. A broad `Effect.tryPromise` around Promise-based business logic does not make that logic compliant.

## Exceptions

Outside an explicitly registered exception, do not author async/await workflows, Promise constructors/combinators/chains, or detached asynchronous work. Promise conversion at an external framework or SDK contract is limited to the smallest justified boundary. `Effect.tryPromise` and `Effect.runPromise` are boundary tools, not general escape hatches.

Each exception must record:

- A stable ID and exact file/symbol or call site. No package-wide wildcard.
- The external contract and why a native Effect alternative cannot currently serve it.
- The allowed conversion and its limits, with no application orchestration inside the bridge.
- Typed failure mapping, interruption behavior, and cleanup ownership. State unsupported cancellation explicitly.
- Boundary tests and the exact static-check allowance associated with the ID.
- A review/removal condition, such as an upstream native integration becoming available.

Convenience, existing code, and a framework name are insufficient justifications. V1 exceptions are not automatically accepted for V2. No concrete V2 Promise exception is approved by this document.

## Required enforcement

Compiler diagnostics, Oxlint, and architecture checks must reject unregistered Promise orchestration, unregistered runtime entry points, and stale exception allowances. React Islands must not import provider implementations or execute application orchestration directly; shared view/event contracts are allowed.

Test meaningful UI transitions and service results, typed failure handling, stale results, interruption on disposal, and cleanup at registered bridges. Apply the same exception discipline to Alchemy deployment code and test helpers.

V2 targets the published compatible toolchain: Effect `4.1.5`, `@effect/tsgo` `0.73.2`, `tsrs` `7.1.0-beta.tsrs3`, Oxlint `1.94.0`, Oxfmt `0.79.0`, and Foldkit `0.171.0`. Complete gate enforcement, Foldkit runtime behavior, and Postgres/workflow lifecycle behavior must be proven in the greenfield implementation before claiming compliance.

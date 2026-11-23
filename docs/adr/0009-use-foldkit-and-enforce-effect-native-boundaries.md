# Use Foldkit with React Islands and enforce Effect-native boundaries

Status: accepted, 2026-11-22.

## Context

The owner requires a fully Effect-native V2, including the UI. Foldkit with React Islands is a fixed architecture decision. Promise-based application code is allowed only through a documented, justified exception.

## Decision

Foldkit owns the UI application model, state transitions and Effect execution. React Islands receive typed view data and emit typed interactions. Application orchestration, networking, resource lifetimes and cancellation remain in Effect.

There is no blanket exception for UI, adapters, SDKs, tests or infrastructure. An unavoidable Promise interface needs an exact, justified boundary record. Wrapping a Promise-based application workflow in Effect does not satisfy this rule. Pure synchronous computation and rendering remain pure.

The normative V2 contract is [V2 Effect boundaries](../v2-effect-boundaries.md). V1 exception categories do not carry over automatically.

## Consequences

The implementation must enforce these boundaries with lint and architecture checks, and test interruption, cleanup and typed failures at approved bridges. Foldkit integration and these enforcement gates remain to be implemented and verified. This decision does not claim compatibility proof or a working V2 application.

Updated on 2026-11-23: `foldkit@0.171.0` targets Effect `~4.1.0` and `@effect/platform-browser ~4.1.0`. Foldkit owns the standalone Web Decision Inbox and receives live updates over SSE or WebSockets from the Effect control-plane server. React Islands are limited strictly to irreplaceable third-party widgets such as a diff viewer. Custom evidence renderers and T3 embedding are out of V2 scope.

# Use Postgres as the single state store and keep verification cloud-only

Status: accepted, 2026-11-23.

## Context

The 2026-11-22 V2 draft left four structural conflicts open:

1. Mixing Neon PostgreSQL for acceptance state with Cloudflare Workers and Cloudflare Workflows or Durable Objects risked splitting state across two writable stores and clashed with `@effect/sql-pg` and self-hosting.
2. Assigning temporary per-PR sandboxes to Alchemy deployment state conflated durable infrastructure provisioning with runtime attempt lifecycles.
3. Scheduling Arbeo Android verification on a developer's personal Mac via SimLock exposed personal machines to untrusted PR execution and diverged from hosted operation.
4. Requiring a custom source-built `Effect-TS/tsgo` compiler for `tsrs4` created a Rust/Go build and distribution burden over a one-day prerelease lag.

## Decision

1. **PostgreSQL is the single source of truth.** Run the Patchplane control plane as a long-lived Bun Effect server on Cloudflare Containers deployed through Alchemy (`@alchemy.run/cloudflare/Containers`). Connect to one PostgreSQL database (Neon for hosted, standard PostgreSQL for self-hosted) via `@effect/sql-pg`. That single database stores acceptance state, Decision Inbox records, provenance, and the `effect/workflow` plus `ClusterWorkflowEngine` SQL journal. Immutable raw artifact bytes live in R2 or S3, referenced by SHA-256 digest from Postgres. Live Web Inbox updates stream from the Effect server over SSE or WebSockets.
2. **Split Alchemy bindings from Effect workflow lifecycles.** Alchemy deploys durable resources, `Daytona.Snapshot` and optional `Daytona.WarmPool` definitions, and the scoped `Daytona.CreateSandbox` runtime binding. Effect workflows create, track, verify deletion of, and reconcile per-PR sandboxes at runtime without ignoring deletion failures.
3. **Never touch personal devices.** Patchplane never executes untrusted verification or candidate builds on a user's personal machine. Drop personal-machine SimLock from V2. Arbeo Android verification builds untrusted PR code in an isolated Linux sandbox to produce a SHA-256-hashed APK, then executes that APK through a cloud Android device adapter, using GitHub Actions Linux KVM (`ubuntu-latest` with `/dev/kvm`) as the initial provider while keeping the adapter open to other cloud runners (such as Expo Simulators or `agent-device` on a dedicated cloud KVM/SimLock worker pool; avoid Firebase Test Lab due to its 2027 shutdown).
4. **Auth, MCP grants, verifier runtime, and published toolchain.** Use WorkOS with GitHub OAuth for B2B authentication, with session-scoped MCP configuration grants by default. Run Codex, Antigravity, or Effect AI behind the verifier-runtime adapter inside isolated cloud sandboxes. Pin published `@effect/tsgo@0.73.2` with `tsrs@7.1.0-beta.tsrs3` alongside Effect `4.1.5`, Oxlint `1.94.0`, Oxfmt `0.79.0`, Alchemy `2.0.0-beta.87`, and Foldkit `0.171.0`. Upgrade to `tsrs4` once a published `@effect/tsgo` release supports it instead of maintaining a custom compiler build pipeline.

5. **Containers are stateless compute.** Cloudflare Containers sleep, restart and lose local disk, and each one is fronted by a Durable Object. The fronting Durable Object holds no Patchplane state. Workflows resume from the Postgres journal, and a stateless scheduled Worker wakes the server so durable timers fire.
6. **Identity and repository authority are separate checks.** WorkOS with GitHub OAuth signs users in. A GitHub App supplies webhooks, installation tokens and repository permission checks. Verifier sandboxes receive only short-lived, attempt-scoped model credentials.

## Consequences

- Hosted and self-hosted deployments share one database architecture and one workflow journal with transactional consistency and no Cloudflare Workflows or Durable Objects lock-in.
- Sandbox leaks remain visible and reconcilable via attempt labels and `Daytona.CreateSandbox` rather than hidden inside Alchemy stack state.
- Cloud Android verification on GitHub Actions Linux KVM keeps strict isolation from personal machines without requiring a paid simulator subscription up front, while preserving parity with hosted runs.
- Stack proof must verify `effect/workflow` + `ClusterWorkflowEngine` on Neon Postgres, Alchemy deployment of the Bun Effect server on Cloudflare Containers and `Daytona.CreateSandbox`, WorkOS + session-scoped MCP delegation, Foldkit `0.171.0`, and the GitHub Actions KVM Arbeo path.

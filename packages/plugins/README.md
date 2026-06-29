# `@patchplane/plugins`

Infrastructure plugins for PatchPlane service boundaries.

`packages/plugins` is where SDK-specific infrastructure lives. Core workflows depend on PatchPlane-owned services from `packages/core`; this package provides concrete Effect layers for providers such as WorkOS, Convex, GitHub, Daytona, Sentry, and local observability.

## Runtime/Pi architecture

The alpha Pi integration is sandbox-backed. PatchPlane does not run the Pi coding-agent runtime in the trusted control plane or browser/server Worker bundle. Daytona launches Pi inside a remote sandbox and PatchPlane treats all Pi output as untrusted until normalized.

Current Pi runtime modules live under:

```text
src/sandbox-runtime/pi/
  command.ts          # data-only Pi CLI launch specs for remote sandbox execution
  contract.ts         # Effect RPC command contract for Pi operations
  runtime-session.ts  # Effect-facing PiRuntimeSession facade
  transport.ts        # Effect RPC command sender -> Pi JSONL stdin transport
  jsonl.ts            # strict LF JSONL Stream decoder
  protocol.ts         # Pi stdout response/event classifier
  ingestion.ts        # Stream-based normalized RuntimeEvent decoder
  events.ts           # JSON-mode event summaries and parser
  config.ts           # Effect Config-backed provider credential env mapping
```

The RPC mode flow is:

```text
DaytonaSandboxPlugin
→ start Daytona async session command running `pi --mode rpc`
→ makePiRuntimeSession(...)
→ typed Effect RPC commands (`get_state`, `prompt`, `steer`, `follow_up`, `abort`)
→ Pi JSONL over Daytona session stdin
→ Daytona stdout callback Stream
→ strict JSONL line stream
→ normalized PiRpcRuntimeEvent stream
→ StorageService / telemetry / smoke assertions
```

Raw Pi JSONL commands are private to the transport layer. Core, Convex read models, and UI-facing code should only see PatchPlane-owned runtime session metadata and normalized `RuntimeEvent` records.

## Daytona live smoke

The package script:

```bash
bun run --cwd packages/plugins smoke:daytona-rpc
```

runs a real Daytona/Pi RPC smoke. It requires `DAYTONA_API_KEY` and a model provider key in the environment. From the repository root:

```bash
set -a
source .env.local
set +a

PATCHPLANE_SMOKE_REPOSITORY_URL=https://github.com/octocat/Hello-World \
PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME=octocat/Hello-World \
PATCHPLANE_PI_PROVIDER=openai \
PATCHPLANE_PI_MODEL=gpt-4o-mini \
PATCHPLANE_SMOKE_TIMEOUT_SECONDS=180 \
bun run --cwd packages/plugins smoke:daytona-rpc
```

The smoke validates command responses, streamed runtime events, steer/follow-up/abort controls, runtime session termination, and final Daytona sandbox deletion. It prints JSONL to stdout; use `tee` if you want to persist the transcript.

## Local observability

`src/observability/LocalObservabilityPlugin.ts` writes Effect logs to:

```text
.patchplane/logs/effect.jsonl
```

Only `Effect.log*` messages go through this logger. Raw `console.log` smoke JSONL is intentionally stdout-oriented unless redirected with `tee`.

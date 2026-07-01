# Fix Alchemy local Vite dev socket for TanStack Start

## Summary

- Patch `@distilled.cloud/cloudflare-runtime@0.11.3` so the local runtime socket targets the user worker directly instead of the first middleware service.
- Keep the existing `@distilled.cloud/cloudflare-vite-plugin@0.11.3` module-runner lazy `AsyncFunction` patch.
- Add a focused regression test to ensure `alchemy.run.ts` does not reintroduce the external `localhost:3000` workaround and both dependency patches stay registered.

## Problem

`bun infra:dev` failed while Alchemy tried to connect to the Vite module runner:

```text
Error: WebSocket connection to 'ws://127.0.0.1:<port>/__vite_module_runner/init' failed: Expected 101 status code
```

The failing port was a local `workerd` process. Direct probes to `/__vite_module_runner/init` returned workerd's generic 500 response. Running the app externally on port 3000 avoided this path, but that required:

```ts
dev: { mode: 'external', url: 'http://localhost:3000' }
```

## Root Cause Found

Alchemy's `Cloudflare.Website.Vite` path uses `@distilled.cloud/cloudflare-vite-plugin`, which starts a local `@distilled.cloud/cloudflare-runtime` worker. That runtime socket was configured to route traffic through the first middleware service:

```ts
service: { name: config.entry ?? SERVICE_USER_WORKER }
```

For this app, the client entry was the assets/router middleware. The Vite module-runner WebSocket upgrade did not survive that middleware path, so the module runner never returned `101 Switching Protocols`.

Pointing the socket directly at the user worker lets the Vite module-runner Durable Object handle `/__vite_module_runner/init` directly.

## Patch

The local Bun patch changes both runtime source and published dist:

```ts
service: { name: SERVICE_USER_WORKER }
```

and:

```js
service: { name: "user-worker" }
```

Patch file:

```text
patches/@distilled.cloud%2Fcloudflare-runtime@0.11.3.patch
```

## Verification

```sh
bun install
bun run test:infra-patches
bun infra:dev
curl -I --max-time 10 http://localhost:1341/
curl -I --max-time 10 http://localhost:1341/en
```

Observed:

- `bun run test:infra-patches` passes.
- `bun infra:dev` completes with `Done: 6 succeeded`.
- `/` returns `307 Temporary Redirect` to `/en`.
- `/en` returns `200 OK`.

## Upstream Note

This is a pragmatic local patch. A cleaner upstream fix may be to let the runtime expose a direct dev socket for internal Vite/module-runner traffic while preserving middleware routing for normal HTTP requests.

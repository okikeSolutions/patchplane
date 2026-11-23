import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Daytona from '@alchemy.run/daytona'
import * as Neon from '@alchemy.run/neon'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import {
  type Context,
  Effect,
  Exit,
  Layer,
  Option,
  Scope,
  SynchronizedRef,
} from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type * as Redacted from 'effect/Redacted'
import type { ArtifactStore, SandboxProvider } from '@patchplane/core'
import { sanitizeErrorMessage } from '@patchplane/domain'
import {
  makeDaytonaSandboxProviderLayer,
  makeR2ArtifactStoreLayer,
} from '@patchplane/plugins'
import {
  makeControlPlaneSingleStoreLayer,
  wakeControlPlane,
} from '@patchplane/server'
import {
  CONTROL_PLANE_UNAVAILABLE,
  ControlPlaneContainer,
  ControlPlaneWakeError,
} from './control-plane-container'
import {
  PatchplaneArtifacts,
  PatchplaneDb,
  PatchplaneVerificationSnapshot,
} from './resources'

type ControlPlaneRuntimeServices =
  | Layer.Success<ReturnType<typeof makeControlPlaneSingleStoreLayer>>
  | SandboxProvider
  | ArtifactStore

const wrapDaytonaHandle = (
  handle: Daytona.DaytonaSandbox,
  runtimeContext: Context.Service.Shape<typeof RuntimeContext>,
) => ({
  sandboxId: handle.sandboxId,
  exec: (command: string, options?: Parameters<typeof handle.exec>[1]) =>
    handle
      .exec(command, options)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext)),
})

const bindDaytonaClient = (
  sandboxes: Daytona.CreateSandboxClient,
  runtimeContext: Context.Service.Shape<typeof RuntimeContext>,
) => ({
  create: (input?: Parameters<Daytona.CreateSandboxClient['create']>[0]) =>
    sandboxes.create(input).pipe(
      Effect.map((handle) => wrapDaytonaHandle(handle, runtimeContext)),
      Effect.provideService(RuntimeContext, runtimeContext),
    ),
  get: (idOrName: string) =>
    sandboxes.get(idOrName).pipe(
      Effect.map((handle) =>
        handle === undefined
          ? undefined
          : wrapDaytonaHandle(handle, runtimeContext),
      ),
      Effect.provideService(RuntimeContext, runtimeContext),
    ),
  list: (input?: Parameters<Daytona.CreateSandboxClient['list']>[0]) =>
    sandboxes
      .list(input)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext)),
  delete: (idOrName: string) =>
    sandboxes
      .delete(idOrName)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext)),
})

const bindR2Bucket = (
  bucket: Cloudflare.R2.ReadWriteBucketClient,
  runtimeContext: Context.Service.Shape<typeof RuntimeContext>,
) => ({
  put: (
    key: string,
    value: Uint8Array,
    options?: {
      readonly httpMetadata?: { readonly contentType?: string }
      readonly customMetadata?: Record<string, string>
    },
  ) =>
    bucket
      .put(key, value, options)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext)),
  get: (key: string) =>
    bucket.get(key).pipe(Effect.provideService(RuntimeContext, runtimeContext)),
})

export default ControlPlaneContainer.make(
  {
    main: import.meta.url,
    runtime: 'bun',
    instanceType: 'lite',
    maxInstances: 1,
  },
  Effect.gen(function* () {
    const db = yield* Neon.Connect(PatchplaneDb)
    // Scoped Daytona runtime binding (`write:sandboxes` + `delete:sandboxes` only).
    const sandboxes = yield* Daytona.CreateSandbox(
      PatchplaneVerificationSnapshot,
    )
    // Scoped R2 read/write binding for SHA-256-verified evidence artifacts.
    const artifactsBucket =
      yield* Cloudflare.R2.ReadWriteBucket(PatchplaneArtifacts)

    // One Postgres pool + ClusterWorkflowEngine + Daytona + R2 runtime per container process.
    const controlPlaneRef = yield* SynchronizedRef.make<
      Option.Option<Context.Context<ControlPlaneRuntimeServices>>
    >(Option.none())

    const acquireControlPlane = SynchronizedRef.modifyEffect(
      controlPlaneRef,
      (current) =>
        Option.match(current, {
          onSome: (services) => Effect.succeed([services, current] as const),
          onNone: () =>
            Effect.gen(function* () {
              // SingleRunner + SqlRunnerStorage use session advisory locks and
              // prepared statements, which require Neon's direct (session) URL
              // rather than PgBouncer transaction pooling.
              const connectionString: Redacted.Redacted =
                yield* db.directConnectionString
              const runtimeContext = yield* RuntimeContext

              const singleStoreLayer = makeControlPlaneSingleStoreLayer({
                url: connectionString,
                maxConnections: 5,
                entityMailboxPollIntervalMs: 250,
              })
              const sandboxProviderLayer = makeDaytonaSandboxProviderLayer(
                bindDaytonaClient(sandboxes, runtimeContext),
              )
              const artifactStoreLayer = makeR2ArtifactStoreLayer(
                bindR2Bucket(artifactsBucket, runtimeContext),
              ).pipe(Layer.provide(singleStoreLayer))

              const fullLayer = Layer.mergeAll(
                singleStoreLayer,
                sandboxProviderLayer,
                artifactStoreLayer,
              )

              // Process-lifetime scope: released when the container exits.
              const scope = yield* Scope.make()
              const services = yield* Layer.buildWithScope(
                fullLayer,
                scope,
              ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
              return [services, Option.some(services)] as const
            }),
        }),
    )

    const runWakeAgainstPostgres = Effect.fn(
      'ControlPlaneContainer.runWakeAgainstPostgres',
    )(
      function* (trigger: string) {
        const services = yield* acquireControlPlane
        const result = yield* wakeControlPlane().pipe(Effect.provide(services))
        return {
          ok: result.ok,
          trigger,
          wokenAt: result.wokenAt,
        }
      },
      (effect, trigger) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new ControlPlaneWakeError({
                trigger,
                message: sanitizeErrorMessage(cause),
                cause,
              }),
          ),
        ),
    )

    const handleFetch = Effect.fn('ControlPlaneContainer.fetch')(function* () {
      const woken = yield* runWakeAgainstPostgres('http')
      return yield* HttpServerResponse.json({
        status: woken.ok ? 'ok' : 'degraded',
        runtime: 'bun',
        wokenAt: woken.wokenAt,
      })
    })

    const fetchEffect = handleFetch().pipe(
      Effect.catchTag('ControlPlaneWakeError', (error) =>
        // Details stay in server logs; the response body never echoes causes.
        Effect.logError('ControlPlaneContainer.fetch failed', {
          trigger: error.trigger,
          message: error.message,
        }).pipe(
          Effect.andThen(
            HttpServerResponse.json(
              {
                status: 'error',
                runtime: 'bun',
                error: CONTROL_PLANE_UNAVAILABLE,
              },
              { status: 503 },
            ),
          ),
        ),
      ),
    )

    return ControlPlaneContainer.of({
      wake: Effect.fn('ControlPlaneContainer.wake')(function* (
        trigger: string,
      ) {
        return yield* runWakeAgainstPostgres(trigger)
      }),
      fetch: fetchEffect,
    })
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Container runtime entry point (main: import.meta.url)
    Effect.provide(
      Layer.mergeAll(
        Neon.ConnectHttp,
        Daytona.CreateSandboxHttp,
        Cloudflare.R2.ReadWriteBucketHttp,
      ),
    ),
  ),
)

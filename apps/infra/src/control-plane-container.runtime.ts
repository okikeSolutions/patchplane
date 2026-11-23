import * as Neon from '@alchemy.run/neon'
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
import { sanitizeErrorMessage } from '@patchplane/domain'
import {
  makeControlPlaneSingleStoreLayer,
  wakeControlPlane,
} from '@patchplane/server'
import {
  CONTROL_PLANE_UNAVAILABLE,
  ControlPlaneContainer,
  ControlPlaneWakeError,
} from './control-plane-container'
import { PatchplaneDb } from './resources'

type SingleStoreServices = Layer.Success<
  ReturnType<typeof makeControlPlaneSingleStoreLayer>
>

export default ControlPlaneContainer.make(
  {
    main: import.meta.url,
    runtime: 'bun',
    instanceType: 'lite',
    maxInstances: 1,
  },
  Effect.gen(function* () {
    const db = yield* Neon.Connect(PatchplaneDb)

    // One Postgres pool + ClusterWorkflowEngine runner per container process.
    // Building it per wake would open a fresh pool on every request and tear
    // the runner down before any due durable timer could fire.
    const singleStoreRef = yield* SynchronizedRef.make<
      Option.Option<Context.Context<SingleStoreServices>>
    >(Option.none())

    const acquireSingleStore = SynchronizedRef.modifyEffect(
      singleStoreRef,
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
              // Process-lifetime scope: released when the container exits.
              const scope = yield* Scope.make()
              const services = yield* Layer.buildWithScope(
                makeControlPlaneSingleStoreLayer({
                  url: connectionString,
                  maxConnections: 5,
                  entityMailboxPollIntervalMs: 250,
                }),
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
        const services = yield* acquireSingleStore
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
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Container runtime entry point (main: import.meta.url)
  }).pipe(Effect.provide(Neon.ConnectHttp)),
)

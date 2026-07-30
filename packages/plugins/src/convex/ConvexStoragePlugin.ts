import { Config, Effect, Layer, Option, Schema } from 'effect'
import { StorageService } from '@patchplane/core/services/storage-service'
import { ConvexConfig } from './ConvexConfig'
import { makeWorkflowStorageOperations } from './storage/workflow'
import { makeRuntimeStorageOperations } from './storage/runtime'
import { makeCandidatesStorageOperations } from './storage/candidates'
import { makeVerificationStorageOperations } from './storage/verification'
import { makeReviewStorageOperations } from './storage/review'

export const ConvexStoragePlugin = {
  layer: Layer.effect(
    StorageService,
    Effect.gen(function* () {
      const config = yield* ConvexConfig
      const configuredUrl = config.url.canonical.pipe(
        Option.orElse(() => config.url.legacy),
      )
      if (Option.isNone(configuredUrl)) {
        return yield* Schema.decodeUnknownEffect(Schema.Never)(undefined).pipe(
          Effect.mapError((cause) => new Config.ConfigError(cause)),
        )
      }
      const context = {
        convexUrl: configuredUrl.value.toString().replace(/\/$/, ''),
        systemIngestionSecret: Option.getOrUndefined(
          config.systemIngestionSecret,
        ),
      }
      const workflow = makeWorkflowStorageOperations(context)
      return StorageService.of({
        createWorkflowFromIntake: workflow.createWorkflowFromPrompt,
        ...workflow,
        ...makeRuntimeStorageOperations(context),
        ...makeCandidatesStorageOperations(context),
        ...makeVerificationStorageOperations(context),
        ...makeReviewStorageOperations(context),
      })
    }),
  ),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}

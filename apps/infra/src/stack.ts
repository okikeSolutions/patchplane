import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Neon from '@alchemy.run/neon'
import * as Alchemy from 'alchemy'
import { Effect, Layer } from 'effect'
import ControlPlaneContainerLive from './control-plane-container.runtime'
import { PatchplaneArtifacts, PatchplaneDb } from './resources'
import { WakeupWorker } from './wakeup-worker'

const BaseProviders = Layer.merge(Neon.providers(), Cloudflare.providers())

export const PatchplaneV2Stack = Alchemy.Stack(
  'patchplane-v2',
  {
    providers: BaseProviders,
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const db = yield* PatchplaneDb
    const artifacts = yield* PatchplaneArtifacts
    const worker = yield* WakeupWorker

    return {
      databaseProjectId: db.projectId,
      databaseBranchId: db.defaultBranchId,
      artifactsBucketName: artifacts.bucketName,
      wakeupWorkerName: worker.workerName,
    }
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Alchemy stack entry point
  }).pipe(Effect.provide(ControlPlaneContainerLive)),
)

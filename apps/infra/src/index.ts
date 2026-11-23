import { Effect } from 'effect'

export { ControlPlaneContainer } from './control-plane-container'
export { ControlPlaneHost } from './control-plane-host'
export {
  PatchplaneArtifacts,
  PatchplaneDb,
  PatchplaneVerificationSnapshot,
  POSTGRES_MIGRATIONS_DIR,
} from './resources'
export { PatchplaneV2Stack } from './stack'
export { default as WakeupWorker } from './wakeup-worker'

export const describeV2InfrastructurePlan = Effect.fn(
  'Infra.describeV2InfrastructurePlan',
)(function* () {
  return yield* Effect.succeed({
    controlPlane: 'cloudflare-containers-bun',
    database: 'neon-postgresql-single-store',
    artifacts: 'cloudflare-r2',
    wakeup: 'cloudflare-cron-worker',
    sandboxes: 'daytona-create-sandbox-binding',
  } as const)
})

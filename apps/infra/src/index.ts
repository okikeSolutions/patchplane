import type * as Cloudflare from '@alchemy.run/cloudflare'
import type * as Daytona from '@alchemy.run/daytona'
import type * as Neon from '@alchemy.run/neon'
import type * as Alchemy from 'alchemy'
import { Effect } from 'effect'

export interface V2StackBindings {
  readonly neonProject?: Neon.Project
  readonly daytonaSnapshot?: Daytona.Snapshot
  readonly cloudflareR2?: Cloudflare.R2.Bucket
  readonly stackType?: typeof Alchemy.Stack
}

export const describeV2InfrastructurePlan = Effect.fn(
  'Infra.describeV2InfrastructurePlan',
)(function* () {
  return yield* Effect.succeed({
    controlPlane: 'cloudflare-containers-bun',
    database: 'neon-postgresql-single-store',
    artifacts: 'cloudflare-r2',
    sandboxes: 'daytona-create-sandbox-binding',
  } as const)
})

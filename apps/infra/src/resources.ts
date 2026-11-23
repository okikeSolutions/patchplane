import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Daytona from '@alchemy.run/daytona'
import * as Neon from '@alchemy.run/neon'
import { DEFAULT_POSTGRES_MIGRATIONS_DIR } from '@patchplane/plugins'

export const POSTGRES_MIGRATIONS_DIR = DEFAULT_POSTGRES_MIGRATIONS_DIR

export const PatchplaneDb = Neon.Project('PatchplaneDb', {
  pgVersion: 17,
  region: 'aws-eu-central-1',
  historyRetentionSeconds: 21_600,
  migrations: POSTGRES_MIGRATIONS_DIR,
})

export const PatchplaneArtifacts = Cloudflare.R2.Bucket('PatchplaneArtifacts', {
  lifecycleRules: [
    {
      id: 'hosted-7d-artifact-retention',
      enabled: true,
      prefix: '',
      deleteObjectsTransition: {
        condition: {
          type: 'Age',
          maxAge: 7 * 24 * 60 * 60,
        },
      },
    },
  ],
})

/**
 * Durable Linux verification sandbox base image managed by Alchemy.
 * Per-attempt sandboxes are created dynamically at runtime via the scoped
 * `Daytona.CreateSandbox` binding (`write:sandboxes`, `delete:sandboxes`).
 */
export const PatchplaneVerificationSnapshot = Daytona.Snapshot(
  'PatchplaneVerificationSnapshot',
  {
    image: 'oven/bun:1.3.10-slim',
    cpu: 2,
    memory: 4,
    disk: 10,
  },
)

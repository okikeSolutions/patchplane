import { resolve } from 'node:path'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Neon from '@alchemy.run/neon'

export const POSTGRES_MIGRATIONS_DIR = resolve(
  import.meta.dirname,
  '../../../packages/plugins/src/postgres/migrations',
)

export const PatchplaneDb = Neon.Project('PatchplaneDb', {
  pgVersion: 17,
  region: 'aws-eu-central-1',
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

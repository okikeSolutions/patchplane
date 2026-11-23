import * as Cloudflare from '@alchemy.run/cloudflare'
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

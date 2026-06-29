import * as Test from 'alchemy/Test/Vitest'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import { expect } from '@effect/vitest'
import PatchPlaneInfra from '../../alchemy.run'

const liveInfraTest = false
const destroyAfterLiveTest = false
const liveStage = 'test'

const { test, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  stage: liveStage,
})

test.skipIf(!liveInfraTest)(
  'provisions PatchPlane Cloudflare resources and Workers',
  Effect.gen(function* () {
    const output = yield* deploy(PatchPlaneInfra, { stage: liveStage })

    expect(output.stage).toBe(liveStage)
    expect(output.evidenceBucketName).toContain('patchplane')
    expect(output.evidenceBucketName).toContain('evidence-artifacts')
    expect(output.aiGatewayId).toContain('patchplane')
    expect(output.sourceControlWorkerUrl).toBeUndefined()
    expect(output.githubWebhookWorkerUrl).toContain('workers.dev')
    expect(output.clientUrl).toContain('workers.dev')
    expect(output.runtimeEnv.PATCHPLANE_EVIDENCE_R2_BUCKET).toBe(output.evidenceBucketName)
    expect(output.runtimeEnv.PATCHPLANE_AI_GATEWAY_ID).toBe(output.aiGatewayId)
    expect(output.runtimeEnv.CLOUDFLARE_ACCOUNT_ID).toBe(output.evidenceBucketAccountId)

    if (destroyAfterLiveTest) {
      yield* destroy(PatchPlaneInfra, { stage: liveStage })
    }
  }),
  { timeout: 300_000 },
)

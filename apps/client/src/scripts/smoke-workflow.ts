import { makeWorkOSActorId, makeWorkOSWorkspaceId } from '@patchplane/domain/ids'
import { StorageService } from '@patchplane/core/services/storage-service'
import { withTelemetryContext } from '@patchplane/core/services/telemetry-service'
import { Effect } from 'effect'
import { patchPlaneRuntime, randomTraceId } from '../effect/runtime'

const accessToken = process.env.PATCHPLANE_WORKOS_ACCESS_TOKEN
const userId = process.env.PATCHPLANE_WORKOS_USER_ID
const organizationId = process.env.PATCHPLANE_WORKOS_ORGANIZATION_ID
const actorDisplayName = process.env.PATCHPLANE_WORKOS_ACTOR_NAME ?? 'Smoke user'

if (!accessToken || !userId || !organizationId) {
  throw new Error(
    [
      'Authenticated smoke workflow requires:',
      '  PATCHPLANE_WORKOS_ACCESS_TOKEN',
      '  PATCHPLANE_WORKOS_USER_ID',
      '  PATCHPLANE_WORKOS_ORGANIZATION_ID',
      '',
      'The token must contain the same WorkOS user subject and active organization.',
    ].join('\n'),
  )
}

const actor = {
  id: makeWorkOSActorId(userId),
  displayName: actorDisplayName,
}
const workspaceId = makeWorkOSWorkspaceId(organizationId)

function printInspectCommands() {
  console.log('\nInspect Effect logs:')
  console.log('  tail -f .patchplane/logs/effect.jsonl')
  console.log('\nInspect Convex:')
  console.log('  cd packages/backend && bunx convex logs --history 20 --success')
  console.log('  cd packages/backend && bunx convex data promptRequests --limit 5')
  console.log('  cd packages/backend && bunx convex data workflowRuns --limit 5')
}

async function startWorkflow(prompt: string) {
  const traceId = await randomTraceId()

  const result = await patchPlaneRuntime.runPromise(
    Effect.gen(function* () {
      const storage = yield* StorageService
      return yield* storage.createWorkflowFromPrompt({
        actor,
        workspaceId,
        source: 'app',
        traceId,
        prompt,
        authToken: accessToken,
      })
    }).pipe(
      (effect) => withTelemetryContext({ traceId, operation: 'smoke-workflow:start' }, effect),
      Effect.withLogSpan('smoke-workflow:start'),
    ),
  )

  console.log('\nSmoke workflow started successfully.\n')
  console.log(`traceId: ${traceId}`)
  console.log(`promptRequestId: ${result.promptRequest.id}`)
  console.log(`workflowRunId: ${result.workflowRun.id}`)
  console.log(`workflowStatus: ${result.workflowRun.status}`)

  return result
}

async function listWorkflowStarts(limit: number) {
  const traceId = await randomTraceId()

  const workflowStarts = await patchPlaneRuntime.runPromise(
    Effect.gen(function* () {
      const storage = yield* StorageService
      return yield* storage.listRecentWorkflowStarts({
        workspaceId,
        limit,
        authToken: accessToken,
      })
    }).pipe(
      (effect) => withTelemetryContext({ traceId, operation: 'smoke-workflow:list' }, effect),
      Effect.withLogSpan('smoke-workflow:list'),
    ),
  )

  console.log(`\nRecent workflow starts for workspace ${workspaceId}:\n`)

  if (workflowStarts.length === 0) {
    console.log('No workflow starts found.')
    return workflowStarts
  }

  for (const workflowStart of workflowStarts) {
    console.log(`traceId: ${workflowStart.promptRequest.traceId}`)
    console.log(`promptRequestId: ${workflowStart.promptRequest.id}`)
    console.log(`workflowRunId: ${workflowStart.workflowRun.id}`)
    console.log(`workflowStatus: ${workflowStart.workflowRun.status}`)
    console.log(`prompt: ${workflowStart.promptRequest.prompt}`)
    console.log(
      `createdAt: ${new Date(workflowStart.workflowRun.createdAt).toISOString()}`,
    )
    console.log('---')
  }

  return workflowStarts
}

const prompt =
  process.argv.slice(2).join(' ').trim() ||
  `Smoke workflow from script ${new Date().toISOString()}`

try {
  console.log('\nRunning PatchPlane authenticated workflow smoke tests...')

  await startWorkflow(prompt)
  await listWorkflowStarts(5)

  console.log('\nSmoke tests completed successfully.')
  printInspectCommands()
} finally {
  await patchPlaneRuntime.dispose()
}

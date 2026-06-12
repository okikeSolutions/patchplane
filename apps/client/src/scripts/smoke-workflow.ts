import { devActor, devWorkspace } from '@patchplane/core/dev/context'
import { ListRecentWorkflowStarts } from '@patchplane/core/workflows/list-recent-workflow-starts'
import { StartWorkflowFromPrompt } from '@patchplane/core/workflows/start-workflow-from-prompt'
import { Effect } from 'effect'
import { patchPlaneRuntime } from '../effect/runtime'

const workspaceId = devWorkspace.id

function printInspectCommands() {
  console.log('\nInspect Effect logs:')
  console.log('  tail -f .patchplane/logs/effect.jsonl')
  console.log('\nInspect Convex:')
  console.log('  cd packages/backend && bunx convex logs --history 20 --success')
  console.log('  cd packages/backend && bunx convex data promptRequests --limit 5')
  console.log('  cd packages/backend && bunx convex data workflowRuns --limit 5')
}

async function startWorkflow(prompt: string) {
  const traceId = crypto.randomUUID()

  const result = await patchPlaneRuntime.runPromise(
    StartWorkflowFromPrompt({
      actor: devActor,
      workspace: devWorkspace,
      source: 'dev',
      traceId,
      prompt,
    }).pipe(
      Effect.annotateLogs({ traceId, entrypoint: 'smoke-workflow:start' }),
      Effect.annotateSpans({ traceId, entrypoint: 'smoke-workflow:start' }),
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
  const traceId = crypto.randomUUID()

  const workflowStarts = await patchPlaneRuntime.runPromise(
    ListRecentWorkflowStarts({ workspaceId, limit }).pipe(
      Effect.annotateLogs({ traceId, entrypoint: 'smoke-workflow:list' }),
      Effect.annotateSpans({ traceId, entrypoint: 'smoke-workflow:list' }),
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
  console.log('\nRunning PatchPlane workflow smoke tests...')

  await startWorkflow(prompt)
  await listWorkflowStarts(5)

  console.log('\nSmoke tests completed successfully.')
  printInspectCommands()
} finally {
  await patchPlaneRuntime.dispose()
}

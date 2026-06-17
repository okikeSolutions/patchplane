import { createFileRoute } from '@tanstack/react-router'

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  })
}

function requiredHeader(request: Request, name: string) {
  const value = request.headers.get(name)
  return value === null || value.length === 0 ? undefined : value
}

function allowedRepositories(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    return undefined
  }

  return new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const deliveryId = requiredHeader(request, 'x-github-delivery')
        const eventName = requiredHeader(request, 'x-github-event')
        const signature = requiredHeader(request, 'x-hub-signature-256')

        if (
          deliveryId === undefined ||
          eventName === undefined ||
          signature === undefined
        ) {
          return jsonResponse(
            {
              ok: false,
              error:
                'Missing required GitHub webhook headers: x-github-delivery, x-github-event, x-hub-signature-256',
            },
            { status: 400 },
          )
        }

        if (!import.meta.env.SSR) {
          return jsonResponse(
            { ok: false, error: 'GitHub webhooks are server-only' },
            { status: 404 },
          )
        }

        const [
          effectModule,
          ingestModule,
          startModule,
          runtimeModule,
          errorsModule,
          idsModule,
        ] = await Promise.all([
          import('effect'),
          import('@patchplane/core/workflows/ingest-github-webhook'),
          import('@patchplane/core/workflows/start-workflow-from-intake'),
          import('@/effect/github-runtime'),
          import('@patchplane/domain/errors'),
          import('@patchplane/domain/ids'),
        ])
        const { Cause, Effect, Exit } = effectModule
        const { IngestGitHubWebhookToWorkflowIntake } = ingestModule
        const { StartWorkflowFromIntake } = startModule
        const { githubRuntime } = runtimeModule
        const { publicErrorMessage } = errorsModule
        const { makeWorkspaceId, makeWorkOSWorkspaceId } = idsModule

        const traceId = crypto.randomUUID()
        const payload = await request.text()
        const workspaceId = process.env.PATCHPLANE_GITHUB_WORKSPACE_ID
          ? makeWorkspaceId(process.env.PATCHPLANE_GITHUB_WORKSPACE_ID)
          : process.env.PATCHPLANE_WORKOS_ORGANIZATION_ID
            ? makeWorkOSWorkspaceId(process.env.PATCHPLANE_WORKOS_ORGANIZATION_ID)
            : undefined
        const repositoryAllowlist = allowedRepositories(
          process.env.PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES,
        )

        if (workspaceId === undefined) {
          return jsonResponse(
            {
              ok: false,
              error:
                'PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID is required for GitHub workflow ingestion',
            },
            { status: 500 },
          )
        }

        if (repositoryAllowlist === undefined) {
          return jsonResponse(
            {
              ok: false,
              error:
                'PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES is required for GitHub workflow ingestion',
            },
            { status: 500 },
          )
        }

        const program = Effect.gen(function* () {
          const intake = yield* IngestGitHubWebhookToWorkflowIntake({
            deliveryId,
            eventName,
            signature,
            payload,
            workspaceId,
            traceId,
          })
          const repositoryFullName = intake.externalRef?.repositoryFullName
          if (
            repositoryFullName === undefined ||
            !repositoryAllowlist.has(repositoryFullName.toLowerCase())
          ) {
            return yield* new errorsModule.SourceControlError({
              operation: 'githubWebhookRoute.repositoryAllowlist',
              message: 'GitHub repository is not configured for this PatchPlane workspace',
              cause: { repositoryFullName },
            })
          }

          const workflowStart = yield* StartWorkflowFromIntake(intake)

          return { intake, workflowStart }
        }).pipe(
          Effect.annotateLogs({
            traceId,
            entrypoint: 'githubWebhookRoute',
          }),
          Effect.annotateSpans({
            traceId,
            entrypoint: 'githubWebhookRoute',
          }),
          Effect.withLogSpan('githubWebhookRoute'),
          Effect.withSpan('githubWebhookRoute', {
            attributes: { traceId, deliveryId, eventName },
          }),
        )

        const exit = await githubRuntime.runPromiseExit(program)

        if (Exit.isSuccess(exit)) {
          return jsonResponse(
            {
              ok: true,
              traceId,
              workflowRunId: exit.value.workflowStart.workflowRun.id,
              promptRequestId: exit.value.workflowStart.promptRequest.id,
              externalProvider: exit.value.intake.externalRef?.provider,
              externalEventKind: exit.value.intake.externalRef?.eventKind,
            },
            { status: 202 },
          )
        }

        const cause = Cause.squash(exit.cause)
        const error = publicErrorMessage(cause, 'GitHub webhook ingestion failed')
        console.error('githubWebhookRoute failed', {
          traceId,
          deliveryId,
          eventName,
          error,
          cause: Cause.pretty(exit.cause),
        })

        return jsonResponse(
          {
            ok: false,
            traceId,
            error,
          },
          { status: 400 },
        )
      },
    },
  },
})

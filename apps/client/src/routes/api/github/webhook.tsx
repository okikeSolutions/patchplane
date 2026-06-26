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

function isPatchPlaneResultComment(input: {
  readonly eventKind?: string | undefined
  readonly prompt: string
}) {
  return input.eventKind === 'github.issue_comment.created' &&
    input.prompt.trimStart().startsWith('PatchPlane sandbox run ')
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
          sandboxModule,
          sandboxAgentModule,
          publishModule,
          runtimeModule,
          configModule,
          telemetryModule,
          errorsModule,
        ] = await Promise.all([
          import('effect'),
          import('@patchplane/core/workflows/ingest-github-webhook'),
          import('@patchplane/core/workflows/start-workflow-from-intake'),
          import('@patchplane/core/workflows/run-sandbox-command-for-workflow'),
          import('@patchplane/core/workflows/run-sandbox-agent-for-workflow'),
          import('@patchplane/core/workflows/publish-sandbox-result-to-source'),
          import('@/effect/runtime'),
          import('@/effect/patchplane-config'),
          import('@patchplane/core/services/telemetry-service'),
          import('@patchplane/domain/errors'),
        ])
        const { Cause, Effect, Exit } = effectModule
        const { IngestGitHubWebhookToWorkflowIntake } = ingestModule
        const { StartWorkflowFromIntake } = startModule
        const { RunSandboxCommandForWorkflow } = sandboxModule
        const { RunSandboxAgentForWorkflow } = sandboxAgentModule
        const { PublishSandboxResultToSource } = publishModule
        const { patchPlaneRuntime, randomTraceId } = runtimeModule
        const { loadGitHubWebhookRouteConfig } = configModule
        const { captureTelemetryCause, withTelemetrySpan } = telemetryModule
        const { publicErrorMessage } = errorsModule

        const traceId = await randomTraceId()
        const payload = await request.text()
        const routeConfig = await (async () => {
          try {
            return await patchPlaneRuntime.runPromise(loadGitHubWebhookRouteConfig())
          } catch (error) {
            return error instanceof Error ? error : new Error(String(error))
          }
        })()

        if (routeConfig instanceof Error) {
          return jsonResponse(
            { ok: false, error: routeConfig.message },
            { status: 500 },
          )
        }

        const program = Effect.gen(function* () {
          const intake = yield* IngestGitHubWebhookToWorkflowIntake({
            deliveryId,
            eventName,
            signature,
            payload,
            workspaceId: routeConfig.workspaceId,
            traceId,
          })
          if (isPatchPlaneResultComment({
            eventKind: intake.externalRef?.eventKind,
            prompt: intake.prompt,
          })) {
            yield* Effect.logInfo('Ignoring PatchPlane result comment webhook', {
              deliveryId,
              repository: intake.externalRef?.repositoryFullName,
            })
            return { intake, workflowStart: undefined, sandboxExecution: undefined, publication: undefined }
          }

          const repositoryFullName = intake.externalRef?.repositoryFullName
          if (
            repositoryFullName === undefined ||
            !routeConfig.repositoryAllowlist.has(repositoryFullName.toLowerCase())
          ) {
            return yield* new errorsModule.SourceControlError({
              operation: 'githubWebhookRoute.repositoryAllowlist',
              message: 'GitHub repository is not configured for this PatchPlane workspace',
              cause: { repositoryFullName },
            })
          }

          const workflowStart = yield* StartWorkflowFromIntake(intake)
          const sandboxExecution = routeConfig.execution.mode === 'daytona-pi'
            ? yield* RunSandboxAgentForWorkflow({
                workflowStart,
                provider: routeConfig.execution.provider,
                model: routeConfig.execution.model,
                thinking: routeConfig.execution.thinking,
                apiKey: routeConfig.execution.apiKey,
                timeoutSeconds: routeConfig.execution.timeoutSeconds,
              })
            : yield* RunSandboxCommandForWorkflow({
                workflowStart,
                command: routeConfig.execution.command,
                timeoutSeconds: routeConfig.execution.timeoutSeconds,
              })

          const publication = yield* PublishSandboxResultToSource({
            workflowStart,
            sandboxExecution,
          })

          return { intake, workflowStart, sandboxExecution, publication }
        }).pipe(
          (effect) => withTelemetrySpan({
            traceId,
            operation: 'githubWebhookRoute',
            name: 'githubWebhookRoute',
            attributes: { deliveryId, eventName },
          }, effect),
          Effect.withLogSpan('githubWebhookRoute'),
        )

        const exit = await patchPlaneRuntime.runPromiseExit(program)

        if (Exit.isSuccess(exit)) {
          return jsonResponse(
            {
              ok: true,
              traceId,
              ignored: exit.value.workflowStart === undefined,
              workflowRunId: exit.value.workflowStart?.workflowRun.id,
              promptRequestId: exit.value.workflowStart?.promptRequest.id,
              externalProvider: exit.value.intake.externalRef?.provider,
              externalEventKind: exit.value.intake.externalRef?.eventKind,
              sandboxExecutionId: exit.value.sandboxExecution?.id,
              sandboxStatus: exit.value.sandboxExecution?.status,
              publishedProvider: exit.value.publication?.provider,
              publishedIssueNumber: exit.value.publication?.issueNumber,
            },
            { status: 202 },
          )
        }

        const cause = Cause.squash(exit.cause)
        const error = publicErrorMessage(cause, 'GitHub webhook ingestion failed')

        await patchPlaneRuntime.runPromise(
          captureTelemetryCause({
            traceId,
            operation: 'githubWebhookRoute',
            cause: exit.cause,
            message: 'GitHub webhook ingestion failed',
            attributes: { deliveryId, eventName },
          }),
        )

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

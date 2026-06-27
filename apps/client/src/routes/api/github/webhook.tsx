import { createFileRoute } from '@tanstack/react-router'

export async function resolveGitHubWebhookWorkspace(input: {
  readonly installationId?: number | undefined
  readonly repositoryId?: number | undefined
  readonly repositoryFullName: string
  readonly fallbackWorkspaceId: string
  readonly repositoryAllowlist: ReadonlySet<string>
  readonly lookupConnectedRepository: () => Promise<{ readonly workspaceId: string } | null>
}) {
  const hostedRoute = await input.lookupConnectedRepository()
  const allowlisted = input.repositoryAllowlist.has(input.repositoryFullName.toLowerCase())

  if (hostedRoute === null && !allowlisted) {
    return { workspaceId: undefined, ignoredReason: 'unconnected_repository' as const }
  }

  return {
    workspaceId: hostedRoute?.workspaceId ?? input.fallbackWorkspaceId,
    ignoredReason: undefined,
  }
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  })
}

const patchPlaneResultCommentEventKinds = new Set([
  'github.issue_comment.created',
  'github.pull_request_comment.created',
])

export function isPatchPlaneResultComment(input: {
  readonly eventKind?: string | undefined
  readonly prompt: string
}) {
  return input.eventKind !== undefined &&
    patchPlaneResultCommentEventKinds.has(input.eventKind) &&
    input.prompt.trimStart().startsWith('PatchPlane sandbox run ')
}

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async () =>
        jsonResponse(
          {
            ok: false,
            error: 'GitHub webhooks are handled by the dedicated source-control Worker in hosted Cloudflare deployments',
          },
          { status: 410 },
        ),
    },
  },
})

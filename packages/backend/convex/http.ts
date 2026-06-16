import { httpRouter } from 'convex/server'
import { ConvexError } from 'convex/values'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { authKit } from './auth'

const http = httpRouter()

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  })
}

function requireTrustedWriteSecret(request: Request) {
  const expected = process.env.PATCHPLANE_CONVEX_WRITE_SECRET

  if (!expected) {
    throw new ConvexError('Trusted write secret is not configured')
  }

  if (request.headers.get('x-patchplane-convex-write-secret') !== expected) {
    throw new ConvexError('Trusted write secret is invalid')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkflowStartSource(
  value: unknown,
): value is 'dev' | 'app' | 'github_issue' | 'github_pr_comment' {
  return (
    value === 'dev' ||
    value === 'app' ||
    value === 'github_issue' ||
    value === 'github_pr_comment'
  )
}

function parseWorkflowStartBody(body: unknown) {
  if (!isRecord(body)) {
    throw new ConvexError('Invalid workflow start body')
  }

  if (
    typeof body.workspaceId !== 'string' ||
    typeof body.actorId !== 'string' ||
    typeof body.actorDisplayName !== 'string' ||
    typeof body.traceId !== 'string' ||
    typeof body.prompt !== 'string' ||
    !isWorkflowStartSource(body.source)
  ) {
    throw new ConvexError('Invalid workflow start body')
  }

  return {
    workspaceId: body.workspaceId,
    actorId: body.actorId,
    actorDisplayName: body.actorDisplayName,
    source: body.source,
    traceId: body.traceId,
    prompt: body.prompt,
  }
}

http.route({
  path: '/workflow-starts/create',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      requireTrustedWriteSecret(request)
      const input = parseWorkflowStartBody(await request.json())
      const result = await ctx.runMutation(
        internal.workflowStarts.createTrusted,
        input,
      )

      return jsonResponse(result)
    } catch (cause) {
      return jsonResponse(
        {
          error: cause instanceof Error ? cause.message : 'Workflow start failed',
        },
        { status: 401 },
      )
    }
  }),
})

authKit.registerRoutes(http)

export default http

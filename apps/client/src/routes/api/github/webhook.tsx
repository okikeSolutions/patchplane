import { createFileRoute } from '@tanstack/react-router'

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  })
}

export function githubWebhookGoneResponse() {
  return jsonResponse(
    {
      ok: false,
      error:
        'GitHub webhooks are handled by the dedicated GitHubWebhookWorker in hosted Cloudflare deployments',
    },
    { status: 410 },
  )
}

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: () => githubWebhookGoneResponse(),
    },
  },
})

'use node'

import { httpAction } from './_generated/server'
import { anyApi } from 'convex/server'
import { createGitHubApp } from '../src/github/octokit'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function readString(value: unknown, fallback?: string): string | undefined {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function parseJsonRecord(payload: string) {
  if (payload.length === 0) {
    return {}
  }

  try {
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return {}
  }
}

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Unknown GitHub webhook failure.'
}

function createGitHubAppFromEnv() {
  return createGitHubApp({
    appId: Number(process.env.GITHUB_APP_ID ?? 0),
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(
      /\\n/g,
      '\n',
    ),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    ...(process.env.GITHUB_API_BASE_URL
      ? { baseUrl: process.env.GITHUB_API_BASE_URL }
      : {}),
  })
}

export const githubInstallationCallbackHandler = httpAction(
  async (ctx, request) => {
    const url = new URL(request.url)
    const installationId = Number(url.searchParams.get('installation_id') ?? 0)

    if (!Number.isFinite(installationId) || installationId <= 0) {
      return jsonResponse(
        {
          ok: false,
          error: 'Missing or invalid installation_id query parameter.',
        },
        400,
      )
    }

    await ctx.runMutation(anyApi.github.recordInstallationCallback, {
      externalInstallationId: installationId,
      setupAction: url.searchParams.get('setup_action') ?? undefined,
      setupState: url.searchParams.get('state') ?? undefined,
    })

    await ctx.scheduler.runAfter(
      0,
      anyApi.githubWorker.syncInstallationFromCallback,
      {
        externalInstallationId: installationId,
      },
    )

    return jsonResponse(
      {
        ok: true,
        externalInstallationId: installationId,
        queued: true,
      },
      202,
    )
  },
)

export const githubWebhookHandler = httpAction(async (ctx, request) => {
  const payload = await request.text()
  const receivedAt = Date.now()
  const deliveryId = request.headers.get('x-github-delivery')
  const event = request.headers.get('x-github-event')
  const signature256 = request.headers.get('x-hub-signature-256')

  if (!deliveryId || !event) {
    return jsonResponse(
      {
        ok: false,
        error: 'Missing required GitHub delivery headers.',
      },
      400,
    )
  }

  const parsedPayload = parseJsonRecord(payload)

  const recordResult = await ctx.runMutation(
    anyApi.github.recordWebhookDelivery,
    {
      deliveryId,
      event,
      action: readString(parsedPayload.action),
      externalInstallationId: readNumber(
        (parsedPayload.installation as { id?: unknown } | undefined)?.id,
      ),
      externalRepositoryId: readNumber(
        (parsedPayload.repository as { id?: unknown } | undefined)?.id,
      ),
      repositoryFullName: readString(
        (parsedPayload.repository as { full_name?: unknown } | undefined)
          ?.full_name,
      ),
      repositoryNodeId: readString(
        (parsedPayload.repository as { node_id?: unknown } | undefined)
          ?.node_id,
      ),
      signatureVerified: false,
      payload,
      receivedAt,
    },
  )

  if (recordResult.duplicate) {
    return jsonResponse({
      ok: true,
      duplicate: true,
    })
  }

  const app = createGitHubAppFromEnv()
  let shouldQueue = false
  app.webhooks.on('issue_comment.created', async () => {
    shouldQueue = true
  })

  try {
    await app.webhooks.verifyAndReceive({
      id: deliveryId,
      name: event,
      payload,
      signature: signature256 ?? '',
    })
  } catch (error) {
    const errorMessage = readErrorMessage(error)

    await ctx.runMutation(anyApi.github.markWebhookDeliveryOutcome, {
      deliveryRecordId: recordResult.deliveryRecordId,
      status: 'failed',
      commandEmitted: false,
      errorMessage,
    })

    return jsonResponse(
      {
        ok: false,
        error: errorMessage,
      },
      401,
    )
  }

  if (!shouldQueue) {
    await ctx.runMutation(anyApi.github.markWebhookDeliveryOutcome, {
      deliveryRecordId: recordResult.deliveryRecordId,
      status: 'ignored',
      commandEmitted: false,
      errorMessage: undefined,
    })

    return jsonResponse({
      ok: true,
      commandCount: 0,
    })
  }

  try {
    await ctx.scheduler.runAfter(
      0,
      anyApi.githubWorker.processWebhookDelivery,
      {
        deliveryRecordId: recordResult.deliveryRecordId,
      },
    )
    await ctx.runMutation(anyApi.github.queueWebhookDelivery, {
      deliveryRecordId: recordResult.deliveryRecordId,
    })
  } catch (error) {
    const errorMessage = readErrorMessage(error)

    await ctx.runMutation(anyApi.github.markWebhookDeliveryOutcome, {
      deliveryRecordId: recordResult.deliveryRecordId,
      status: 'failed',
      commandEmitted: false,
      errorMessage,
    })

    return jsonResponse(
      {
        ok: false,
        error: errorMessage,
      },
      500,
    )
  }

  return jsonResponse(
    {
      ok: true,
      queued: true,
      deliveryId,
    },
    202,
  )
})

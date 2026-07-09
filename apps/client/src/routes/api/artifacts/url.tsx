import { createFileRoute } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const getEvidenceArtifact = makeFunctionReference<
  'query',
  {
    artifactId: string
    workflowRunId?: string
  },
  {
    id: string
    workflowRunId: string
    storageProvider: 'cloudflare-r2'
    storageKey: string
    contentType: string
    sizeBytes: number
    sha256: string
  } | null
>('workflowStarts:getEvidenceArtifact')

function configuredConvexUrl() {
  const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (value === undefined || value.trim().length === 0) {
    throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
  }
  return value.replace(/\/$/, '')
}

function requiredEnv(name: string, fallbackName?: string) {
  const value = process.env[name]?.trim() || (fallbackName === undefined ? undefined : process.env[fallbackName]?.trim())
  if (!value) throw new Error(fallbackName === undefined ? `${name} is required` : `${name} or ${fallbackName} is required`)
  return value
}

function validateExpiresInSeconds(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 604_800) {
    throw new Error('expiresInSeconds must be an integer from 1 to 604800')
  }
  return value
}

async function createArtifactReadUrl(input: {
  readonly storageKey: string
  readonly expiresInSeconds: number
}) {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID')
  const rawEndpoint = process.env.CLOUDFLARE_S3_API_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`
  const endpointUrl = new URL(rawEndpoint)
  const endpointBucket = endpointUrl.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)[0]
  endpointUrl.pathname = '/'
  endpointUrl.search = ''
  endpointUrl.hash = ''
  const bucketName = process.env.PATCHPLANE_EVIDENCE_R2_BUCKET?.trim() || endpointBucket || requiredEnv('PATCHPLANE_EVIDENCE_R2_BUCKET')
  const accessKeyId = requiredEnv('PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID')
  const secretAccessKey = requiredEnv('PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY')
  const expiresIn = validateExpiresInSeconds(input.expiresInSeconds)
  const s3 = new S3Client({
    region: 'auto',
    endpoint: endpointUrl.toString().replace(/\/$/, ''),
    credentials: { accessKeyId, secretAccessKey },
  })
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucketName, Key: input.storageKey }),
    { expiresIn },
  )
  return { url, expiresAt: Date.now() + expiresIn * 1000 }
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export const Route = createFileRoute('/api/artifacts/url')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return jsonResponse({ ok: false, error: 'Artifact URL signing is server-only' }, { status: 404 })
        }

        const { getAuth } = await import('@workos/authkit-tanstack-react-start')
        const auth = await getAuth()
        const accessToken = 'accessToken' in auth ? auth.accessToken : undefined
        if (!auth.user || accessToken === undefined) {
          return jsonResponse({ ok: false, error: 'Authentication required' }, { status: 401 })
        }

        const url = new URL(request.url)
        const artifactId = url.searchParams.get('artifactId')?.trim()
        const workflowRunId = url.searchParams.get('workflowRunId')?.trim() || undefined
        const expires = Number(url.searchParams.get('expiresInSeconds') ?? '900')
        if (!artifactId) {
          return jsonResponse({ ok: false, error: 'artifactId is required' }, { status: 400 })
        }

        const convex = new ConvexHttpClient(configuredConvexUrl())
        convex.setAuth(accessToken)
        const artifact = await convex.query(getEvidenceArtifact, {
          artifactId,
          ...(workflowRunId === undefined ? {} : { workflowRunId }),
        })
        if (artifact === null) {
          return jsonResponse({ ok: false, error: 'Artifact not found' }, { status: 404 })
        }

        const signed = await createArtifactReadUrl({
          storageKey: artifact.storageKey,
          expiresInSeconds: expires,
        })
        return jsonResponse({
          ok: true,
          artifactId: artifact.id,
          workflowRunId: artifact.workflowRunId,
          url: signed.url,
          expiresAt: signed.expiresAt,
        })
      },
    },
  },
})

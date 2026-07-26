import { createFileRoute } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Exit, Schema } from 'effect'
import { getEvidenceBucket } from '@/env'
import { createArtifactStorageResponse } from '@/lib/artifact-storage-response'
import { loadConfiguredConvexUrl } from '@/lib/convex-url'

const getEvidenceArtifact = makeFunctionReference<
  'query',
  {
    artifactId: string
    workflowRunId?: string
  },
  unknown
>('workflowStarts:getEvidenceArtifact')

class ArtifactRouteError extends Schema.ErrorClass<ArtifactRouteError>(
  'ArtifactRouteError',
)({
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const EvidenceArtifactRouteRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  workflowRunId: Schema.NonEmptyString,
  storageProvider: Schema.Literal('cloudflare-r2'),
  storageKey: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  sizeBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sha256: Schema.NonEmptyString,
})
const EvidenceArtifactRouteResult = Schema.NullOr(EvidenceArtifactRouteRecord)
function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

const loadArtifactMetadata = Effect.fnUntraced(function*(input: {
  readonly accessToken: string
  readonly artifactId: string
  readonly workflowRunId?: string | undefined
}) {
  const convexUrl = yield* loadConfiguredConvexUrl()
  const artifact = yield* Effect.tryPromise({
    try: () => {
      const convex = new ConvexHttpClient(convexUrl.toString().replace(/\/$/, ''))
      convex.setAuth(input.accessToken)
      return convex.query(getEvidenceArtifact, {
        artifactId: input.artifactId,
        ...(input.workflowRunId === undefined
          ? {}
          : { workflowRunId: input.workflowRunId }),
      })
    },
    catch: (cause) => new ArtifactRouteError({
      message: 'Artifact metadata query failed',
      cause,
    }),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(EvidenceArtifactRouteResult)))
  return artifact
})

export const Route = createFileRoute('/api/artifacts/url')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return jsonResponse({ ok: false, error: 'Artifact access is server-only' }, { status: 404 })
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
        if (!artifactId) {
          return jsonResponse({ ok: false, error: 'artifactId is required' }, { status: 400 })
        }

        const resultExit = await Effect.runPromiseExit(loadArtifactMetadata({
          accessToken,
          artifactId,
          workflowRunId,
        }))
        if (Exit.isFailure(resultExit)) {
          return jsonResponse(
            { ok: false, error: 'Artifact metadata could not be loaded' },
            { status: 502 },
          )
        }
        const artifact = resultExit.value
        if (artifact === null) {
          return jsonResponse({ ok: false, error: 'Artifact not found' }, { status: 404 })
        }

        let bucket: R2Bucket
        try {
          bucket = await getEvidenceBucket()
        } catch {
          return jsonResponse(
            { ok: false, error: 'Artifact storage is unavailable' },
            { status: 503 },
          )
        }

        return createArtifactStorageResponse({
          artifact,
          bucket,
          requestUrl: url,
        })
      },
    },
  },
})

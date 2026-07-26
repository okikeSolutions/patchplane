import { createFileRoute } from '@tanstack/react-router'
import { createR2SignedReadUrl } from '@patchplane/plugins/cloudflare/r2-artifacts-plugin'
import { R2ArtifactsConfig } from '@patchplane/plugins/cloudflare/r2-artifacts-config'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Exit, Schema } from 'effect'
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
const ExpiresInSeconds = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 604_800 }),
)
function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

const loadArtifactReadUrl = Effect.fnUntraced(function*(input: {
  readonly accessToken: string
  readonly artifactId: string
  readonly workflowRunId?: string | undefined
  readonly expiresInSeconds: unknown
}) {
  const convexUrl = yield* loadConfiguredConvexUrl()
  const expiresInSeconds = yield* Schema.decodeUnknownEffect(ExpiresInSeconds)(
    input.expiresInSeconds,
  )
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
  if (artifact === null) return null

  const r2Config = yield* R2ArtifactsConfig
  const signed = yield* createR2SignedReadUrl(r2Config, {
    storageKey: artifact.storageKey,
    expiresInSeconds,
  })
  return { artifact, signed }
})

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
        const expiresInSeconds = Number(url.searchParams.get('expiresInSeconds') ?? '900')
        const preview = url.searchParams.get('preview') === '1'
        if (!artifactId) {
          return jsonResponse({ ok: false, error: 'artifactId is required' }, { status: 400 })
        }

        const resultExit = await Effect.runPromiseExit(loadArtifactReadUrl({
          accessToken,
          artifactId,
          workflowRunId,
          expiresInSeconds,
        }))
        if (Exit.isFailure(resultExit)) {
          return jsonResponse(
            { ok: false, error: 'Artifact URL could not be created' },
            { status: 502 },
          )
        }
        if (resultExit.value === null) {
          return jsonResponse({ ok: false, error: 'Artifact not found' }, { status: 404 })
        }
        const { artifact, signed } = resultExit.value

        if (preview) {
          const previewLimitBytes = 200_000
          const artifactResponse = await fetch(signed.url, {
            headers: { range: `bytes=0-${previewLimitBytes}` },
          })
          if (!artifactResponse.ok) {
            return jsonResponse({ ok: false, error: 'Artifact preview could not be read' }, { status: 502 })
          }
          const bytes = new Uint8Array(await artifactResponse.arrayBuffer())
          if (bytes.includes(0)) {
            return jsonResponse({ ok: false, error: 'Binary artifacts cannot be previewed inline' }, { status: 415 })
          }
          const truncated = artifact.sizeBytes > previewLimitBytes
          const body = new TextDecoder().decode(bytes.slice(0, previewLimitBytes))
          return new Response(
            truncated
              ? `${body}\n\n…preview truncated; open the full evidence artifact to inspect the remainder…`
              : body,
            {
              headers: {
                'content-type': 'text/plain; charset=utf-8',
                'x-patchplane-preview-truncated': String(truncated),
              },
            },
          )
        }
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

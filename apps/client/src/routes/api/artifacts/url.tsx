import { createFileRoute } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Schema } from 'effect'
import { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { getEvidenceBucket } from '@/env'
import {
  artifactMetadataFailureCode,
  type ArtifactMetadataFailureCode,
} from '@/lib/artifact-metadata-failure'
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

class ArtifactRouteError extends Schema.TaggedErrorClass<ArtifactRouteError>()(
  'ArtifactRouteError',
  {
    code: Schema.Literals([
      'artifact_authorization_required',
      'artifact_metadata_unavailable',
      'authentication_required',
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const EvidenceArtifactRouteResult = Schema.NullOr(EvidenceArtifact)
function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

const loadArtifactMetadata = Effect.fnUntraced(function* (input: {
  readonly accessToken: string
  readonly artifactId: string
  readonly workflowRunId?: string | undefined
}) {
  const convexUrl = yield* loadConfiguredConvexUrl()
  const value = yield* Effect.tryPromise({
    try: () => {
      const convex = new ConvexHttpClient(
        convexUrl.toString().replace(/\/$/, ''),
      )
      convex.setAuth(input.accessToken)
      return convex.query(getEvidenceArtifact, {
        artifactId: input.artifactId,
        ...(input.workflowRunId === undefined
          ? {}
          : { workflowRunId: input.workflowRunId }),
      })
    },
    catch: (cause) =>
      new ArtifactRouteError({
        code: artifactMetadataFailureCode(cause),
        message: 'Artifact metadata query failed',
        cause,
      }),
  })
  return yield* Schema.decodeUnknownEffect(EvidenceArtifactRouteResult)(
    value,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ArtifactRouteError({
          code: 'artifact_metadata_unavailable',
          message: 'Artifact metadata response was invalid',
          cause,
        }),
    ),
  )
})

function metadataFailureResponse(code: ArtifactMetadataFailureCode) {
  switch (code) {
    case 'authentication_required':
      return jsonResponse(
        {
          ok: false,
          code,
          error: 'Authentication required',
        },
        { status: 401 },
      )
    case 'artifact_authorization_required':
      return jsonResponse(
        {
          ok: false,
          code,
          error: 'Artifact access denied',
        },
        { status: 403 },
      )
    case 'artifact_metadata_unavailable':
      return jsonResponse(
        {
          ok: false,
          code,
          error: 'Artifact metadata could not be loaded',
        },
        { status: 502 },
      )
  }
}

export const Route = createFileRoute('/api/artifacts/url')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return jsonResponse(
            {
              ok: false,
              code: 'artifact_access_server_only',
              error: 'Artifact access is server-only',
            },
            { status: 404 },
          )
        }

        const { getAuth } = await import('@workos/authkit-tanstack-react-start')
        const auth = await getAuth()
        const accessToken = 'accessToken' in auth ? auth.accessToken : undefined
        if (!auth.user || accessToken === undefined) {
          return jsonResponse(
            {
              ok: false,
              code: 'authentication_required',
              error: 'Authentication required',
            },
            { status: 401 },
          )
        }

        const url = new URL(request.url)
        const artifactId = url.searchParams.get('artifactId')?.trim()
        const workflowRunId =
          url.searchParams.get('workflowRunId')?.trim() || undefined
        if (!artifactId) {
          return jsonResponse(
            {
              ok: false,
              code: 'invalid_artifact_request',
              error: 'artifactId is required',
            },
            { status: 400 },
          )
        }

        const { diffProjectionRuntime } = await import('@/effect/diff-runtime')
        const result = await diffProjectionRuntime.runPromise(
          loadArtifactMetadata({
            accessToken,
            artifactId,
            workflowRunId,
          }).pipe(
            Effect.match({
              onFailure: (error) =>
                ({
                  status: 'failure',
                  code:
                    error instanceof ArtifactRouteError
                      ? error.code
                      : 'artifact_metadata_unavailable',
                }) as const,
              onSuccess: (artifact) =>
                ({ status: 'success', artifact }) as const,
            }),
          ),
        )
        if (result.status === 'failure') {
          return metadataFailureResponse(result.code)
        }
        const { artifact } = result
        if (artifact === null) {
          return jsonResponse(
            {
              ok: false,
              code: 'artifact_metadata_not_found',
              error: 'Artifact not found',
            },
            { status: 404 },
          )
        }

        let bucket: R2Bucket
        try {
          bucket = await getEvidenceBucket()
        } catch {
          return jsonResponse(
            {
              ok: false,
              code: 'artifact_storage_unavailable',
              error: 'Artifact storage is unavailable',
            },
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

import { createFileRoute } from '@tanstack/react-router'
import { makeFunctionReference } from 'convex/server'
import { Effect, Match, Schema } from 'effect'
import { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { convexQuery } from '@patchplane/plugins/convex/http-client'
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

class ArtifactRouteError extends Schema.TaggedError<ArtifactRouteError>()(
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
  const value = yield* convexQuery({
    url: convexUrl.toString().replace(/\/$/, ''),
    auth: input.accessToken,
    reference: getEvidenceArtifact,
    args: {
      artifactId: input.artifactId,
      ...(input.workflowRunId === undefined
        ? {}
        : { workflowRunId: input.workflowRunId }),
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
  return Match.value(code).pipe(
    Match.when('authentication_required', () =>
      jsonResponse(
        {
          ok: false,
          code,
          error: 'Authentication required',
        },
        { status: 401 },
      ),
    ),
    Match.when('artifact_authorization_required', () =>
      jsonResponse(
        {
          ok: false,
          code,
          error: 'Artifact access denied',
        },
        { status: 403 },
      ),
    ),
    Match.when('artifact_metadata_unavailable', () =>
      jsonResponse(
        {
          ok: false,
          code,
          error: 'Artifact metadata could not be loaded',
        },
        { status: 502 },
      ),
    ),
    Match.exhaustive,
  )
}

export const Route = createFileRoute('/api/artifacts/url')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return Promise.resolve(
            jsonResponse(
              {
                ok: false,
                code: 'artifact_access_server_only',
                error: 'Artifact access is server-only',
              },
              { status: 404 },
            ),
          )
        }

        return Effect.runPromise(
          runArtifactUrlRequest(request).pipe(
            Effect.match({
              onFailure: () =>
                jsonResponse(
                  {
                    ok: false,
                    code: 'artifact_metadata_unavailable',
                    error: 'Artifact request failed',
                  },
                  { status: 503 },
                ),
              onSuccess: (response) => response,
            }),
          ),
          { signal: request.signal },
        )
      },
    },
  },
})

const runArtifactUrlRequest = Effect.fn('ArtifactUrlRoute.run')(function* (
  request: Request,
) {
  const { getAuth } = yield* Effect.tryPromise({
    try: () => import('@workos/authkit-tanstack-react-start'),
    catch: (cause) =>
      new ArtifactRouteError({
        code: 'authentication_required',
        message: 'Authentication adapter unavailable',
        cause,
      }),
  })
  const auth = yield* Effect.tryPromise({
    try: () => getAuth(),
    catch: (cause) =>
      new ArtifactRouteError({
        code: 'authentication_required',
        message: 'Authentication unavailable',
        cause,
      }),
  })
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

  const metadata = yield* loadArtifactMetadata({
    accessToken,
    artifactId,
    workflowRunId,
  }).pipe(
    Effect.match({
      onFailure: (error) => ({ status: 'failure', error }) as const,
      onSuccess: (artifact) => ({ status: 'success', artifact }) as const,
    }),
  )
  if (metadata.status === 'failure') {
    return metadataFailureResponse(
      metadata.error instanceof ArtifactRouteError
        ? metadata.error.code
        : 'artifact_metadata_unavailable',
    )
  }
  const { artifact } = metadata
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

  const bucket = yield* Effect.tryPromise({
    try: () => getEvidenceBucket(),
    catch: (cause) =>
      new ArtifactRouteError({
        code: 'artifact_metadata_unavailable',
        message: 'Artifact storage unavailable',
        cause,
      }),
  }).pipe(Effect.option)
  if (bucket._tag === 'None') {
    return jsonResponse(
      {
        ok: false,
        code: 'artifact_storage_unavailable',
        error: 'Artifact storage is unavailable',
      },
      { status: 503 },
    )
  }

  return yield* createArtifactStorageResponse({
    artifact,
    bucket: bucket.value,
    requestUrl: url,
  })
})

import { useState } from 'react'
import { CircleAlertIcon, ExternalLinkIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import type { WorkflowDetail } from './types'
import {
  artifactReferences,
  type WorkflowArtifactReference,
} from './workflow-console-model'
import * as m from '@/paraglide/messages'

export function WorkflowArtifactReferences({
  detail,
}: {
  readonly detail: WorkflowDetail
}) {
  const references = artifactReferences(detail)
  const [openingId, setOpeningId] = useState<string>()
  const [error, setError] = useState<string>()

  if (references.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{m.app_detail_artifacts()}</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {m.app_artifacts_intro()}
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.app_artifacts_empty()}</EmptyTitle>
            <EmptyDescription>
              {m.app_artifacts_empty_detail()}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">{m.app_detail_artifacts()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_artifacts_intro()}
        </p>
        {error === undefined ? null : (
          <Alert role="alert" variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>{m.app_artifact_open_failed()}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <ItemGroup className="gap-2">
        {references.map((reference) => (
          <Item
            key={reference.id}
            id={`artifact-${reference.artifactId ?? reference.id}`}
            size="sm"
            variant="outline"
            className="scroll-mt-32"
          >
            <ItemContent className="min-w-0">
              <ItemTitle className="line-clamp-none break-words [overflow-wrap:anywhere]">
                {reference.label}
              </ItemTitle>
              <ItemDescription className="line-clamp-none break-all font-mono text-xs">
                {reference.value}
              </ItemDescription>
            </ItemContent>
            <Badge variant="secondary" className="w-fit">
              {reference.source}
            </Badge>
            {reference.artifactId === undefined ? null : (
              <Button
                variant="secondary"
                size="icon"
                className="min-h-11 min-w-11 md:min-h-8 md:min-w-8"
                aria-label={m.app_artifact_open({ label: reference.label })}
                aria-busy={openingId === reference.id}
                title={m.app_artifact_open({ label: reference.label })}
                disabled={openingId === reference.id}
                onClick={() => {
                  void openArtifact(reference, {
                    onStart: () => {
                      setError(undefined)
                      setOpeningId(reference.id)
                    },
                    onComplete: () => setOpeningId(undefined),
                    onError: (message) => setError(message),
                  })
                }}
              >
                <ExternalLinkIcon />
              </Button>
            )}
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

export function decodeArtifactUrlPayload(
  value: unknown,
  expected: {
    readonly artifactId: string
    readonly baseUrl: string
    readonly workflowRunId?: string | undefined
  },
) {
  if (typeof value !== 'object' || value === null) return undefined
  const ok = Reflect.get(value, 'ok')
  const url = Reflect.get(value, 'url')
  const error = Reflect.get(value, 'error')
  if (ok === true && typeof url === 'string') {
    try {
      const baseUrl = new URL(expected.baseUrl)
      const resolvedUrl = new URL(url, baseUrl)
      const workflowRunMatches =
        expected.workflowRunId === undefined ||
        resolvedUrl.searchParams.get('workflowRunId') === expected.workflowRunId
      if (
        resolvedUrl.origin === baseUrl.origin &&
        resolvedUrl.pathname === '/api/artifacts/url' &&
        resolvedUrl.searchParams.get('artifactId') === expected.artifactId &&
        resolvedUrl.searchParams.get('download') === '1' &&
        workflowRunMatches
      ) {
        return {
          ok: true as const,
          url: `${resolvedUrl.pathname}${resolvedUrl.search}`,
        }
      }
    } catch {
      return undefined
    }
  }
  return ok === false && typeof error === 'string'
    ? { ok: false as const, error }
    : undefined
}

async function openArtifact(
  reference: WorkflowArtifactReference,
  callbacks: {
    readonly onStart: () => void
    readonly onComplete: () => void
    readonly onError: (message: string) => void
  },
) {
  if (reference.artifactId === undefined) return

  callbacks.onStart()
  try {
    const params = new URLSearchParams({
      artifactId: reference.artifactId,
    })
    if (reference.workflowRunId !== undefined) {
      params.set('workflowRunId', reference.workflowRunId)
    }
    const response = await fetch(`/api/artifacts/url?${params.toString()}`)
    const payload = decodeArtifactUrlPayload(await response.json(), {
      artifactId: reference.artifactId,
      baseUrl: window.location.href,
      workflowRunId: reference.workflowRunId,
    })
    if (!response.ok || payload?.ok !== true) {
      callbacks.onError(
        payload?.ok === false ? payload.error : m.app_artifact_open_failed(),
      )
      return
    }
    window.location.assign(payload.url)
  } catch (cause) {
    callbacks.onError(
      cause instanceof Error ? cause.message : m.app_artifact_open_failed(),
    )
  } finally {
    callbacks.onComplete()
  }
}

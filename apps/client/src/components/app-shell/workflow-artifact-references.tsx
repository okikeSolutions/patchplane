import { useState } from 'react'
import { ExternalLinkIcon, FileArchiveIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { WorkflowDetail } from './types'
import { artifactReferences, type WorkflowArtifactReference } from './workflow-console-model'

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
          <h3 className="text-sm font-medium">Artifacts</h3>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Evidence artifact references linked from runtime events.
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileArchiveIcon /></EmptyMedia>
            <EmptyTitle>No artifact references</EmptyTitle>
            <EmptyDescription>
              Runtime events and command logs are recorded. R2-backed artifact metadata appears here when available.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Artifacts</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Evidence artifact references linked from runtime events.
        </p>
        {error === undefined ? null : (
          <p className="m-0 mt-2 text-xs text-destructive">{error}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {references.map((reference) => (
          <Card key={reference.id} size="sm" className="ring-border/60">
            <CardContent className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{reference.label}</div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {reference.value}
                </div>
              </div>
              <Badge variant="secondary" className="w-fit bg-muted text-muted-foreground">
                {reference.source}
              </Badge>
              {reference.artifactId === undefined ? null : (
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={`Open ${reference.label}`}
                  title={`Open ${reference.label}`}
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
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
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
      expiresInSeconds: '900',
    })
    if (reference.workflowRunId !== undefined) {
      params.set('workflowRunId', reference.workflowRunId)
    }
    const response = await fetch(`/api/artifacts/url?${params.toString()}`)
    const payload = await response.json() as { ok?: boolean; url?: string; error?: string }
    if (!response.ok || payload.ok !== true || payload.url === undefined) {
      callbacks.onError(payload.error ?? 'Artifact URL could not be created')
      return
    }
    window.open(payload.url, '_blank', 'noreferrer')
  } catch (cause) {
    callbacks.onError(cause instanceof Error ? cause.message : 'Artifact URL could not be created')
  } finally {
    callbacks.onComplete()
  }
}

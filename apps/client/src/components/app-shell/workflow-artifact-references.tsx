import { FileArchiveIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { WorkflowDetail } from './types'
import { artifactReferences } from './workflow-console-model'

export function WorkflowArtifactReferences({
  detail,
}: {
  readonly detail: WorkflowDetail
}) {
  const references = artifactReferences(detail)

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
      </div>
      <div className="flex flex-col gap-2">
        {references.map((reference) => (
          <Card key={reference.id} size="sm" className="ring-border/60">
            <CardContent className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{reference.label}</div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {reference.value}
                </div>
              </div>
              <Badge variant="secondary" className="w-fit bg-muted text-muted-foreground">
                {reference.source}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PromptRequestRow } from './types'

export function RecentWorkflowsCard({
  requests,
}: {
  readonly requests: ReadonlyArray<PromptRequestRow> | undefined
}) {
  const rows = requests ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent workflows</CardTitle>
        <CardDescription>
          Current Convex read model for workflow prompts visible to this actor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requests === undefined ? (
          <p className="m-0 text-sm text-muted-foreground">
            {m.app_authenticated_loading()}
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No workflows are visible yet. Start one from the prompt card.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prompt</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trace</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 6).map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="max-w-[24rem] truncate">
                    {request.prompt}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{request.source}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{request.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">
                      {request.traceId}
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

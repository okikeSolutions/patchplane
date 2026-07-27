import { useState } from 'react'
import { ChevronDownIcon, CopyIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import * as m from '@/paraglide/messages'
import { getAppLocale } from './app-language'

export type WorkflowEvidenceTableRow = {
  readonly detail: string
  readonly key: string
  readonly label: string
  readonly occurredAt?: number
  readonly source: string
  readonly title: string
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(getAppLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function copyText(value: string) {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    throw new Error('Clipboard access is unavailable')
  }
  await navigator.clipboard.writeText(value)
}

export function WorkflowEvidenceTable({
  caption,
  emptyTitle,
  rows,
}: {
  readonly caption: string
  readonly emptyTitle: string
  readonly rows: ReadonlyArray<WorkflowEvidenceTableRow>
}) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CopyIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{m.app_table_empty_detail()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border [&_[data-slot=table-container]]:overflow-x-hidden">
      <Table className="table-fixed">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <colgroup>
          <col />
          <col className="w-0 lg:w-1/4" />
          <col className="w-0 sm:w-28 lg:w-32" />
          <col className="w-0 2xl:w-44" />
          <col className="w-12" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{m.app_table_record()}</TableHead>
            <TableHead className="invisible w-0 overflow-hidden p-0 lg:visible lg:w-auto lg:p-2">
              {m.app_table_source()}
            </TableHead>
            <TableHead className="invisible w-0 overflow-hidden p-0 sm:visible sm:w-auto sm:p-2">
              {m.app_table_state()}
            </TableHead>
            <TableHead className="invisible w-0 overflow-hidden p-0 text-right 2xl:visible 2xl:w-auto 2xl:p-2">
              {m.app_table_occurred()}
            </TableHead>
            <TableHead className="w-12 text-right">
              <span className="sr-only">{m.app_table_details()}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {rows.map((row, index) => (
          <WorkflowEvidenceTableRows
            isLast={index === rows.length - 1}
            key={row.key}
            row={row}
          />
        ))}
      </Table>
    </div>
  )
}

function WorkflowEvidenceTableRows({
  isLast,
  row,
}: {
  readonly isLast: boolean
  readonly row: WorkflowEvidenceTableRow
}) {
  const [copyStatus, setCopyStatus] = useState<string>()

  return (
    <Collapsible
      render={
        <TableBody
          className={isLast ? undefined : '[&_tr:last-child]:border-b'}
        />
      }
    >
      <TableRow>
        <TableCell className="min-w-0 overflow-hidden whitespace-normal">
          <span
            className="block min-w-0 truncate font-medium"
            title={row.title}
          >
            {row.title}
          </span>
          <span
            className="mt-1 block truncate text-xs text-muted-foreground sm:hidden"
            title={`${row.label} · ${row.source}`}
          >
            {row.label} · {row.source}
          </span>
        </TableCell>
        <TableCell className="invisible w-0 overflow-hidden p-0 lg:visible lg:w-auto lg:p-2">
          <span
            className="block truncate font-mono text-xs text-muted-foreground"
            title={row.source}
          >
            {row.source}
          </span>
        </TableCell>
        <TableCell className="invisible w-0 overflow-hidden p-0 sm:visible sm:w-auto sm:p-2">
          <Badge variant="secondary" className="max-w-full">
            <span className="truncate">{row.label}</span>
          </Badge>
        </TableCell>
        <TableCell className="invisible w-0 overflow-hidden p-0 text-right 2xl:visible 2xl:w-auto 2xl:p-2">
          {row.occurredAt === undefined ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <time
              className="text-xs text-muted-foreground"
              dateTime={new Date(row.occurredAt).toISOString()}
            >
              {formatTimestamp(row.occurredAt)}
            </time>
          )}
        </TableCell>
        <TableCell className="p-1 text-right">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="[&[aria-expanded=true]_svg]:rotate-180"
                aria-label={`${m.app_table_show_details()} ${row.title}`}
              />
            }
          >
            <ChevronDownIcon className="transition-transform" />
          </CollapsibleTrigger>
        </TableCell>
      </TableRow>
      <CollapsibleContent
        render={<TableRow className="bg-muted/20 hover:bg-muted/20" />}
      >
        <TableCell className="p-0 whitespace-normal" colSpan={5}>
          <div className="flex flex-col gap-3 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs text-muted-foreground">
              <span className="break-all font-mono">{row.source}</span>
              {row.occurredAt === undefined ? null : (
                <>
                  {' · '}
                  <time dateTime={new Date(row.occurredAt).toISOString()}>
                    {formatTimestamp(row.occurredAt)}
                  </time>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <output
                aria-live="polite"
                className="text-xs text-muted-foreground"
              >
                {copyStatus}
              </output>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 md:min-h-8"
                onClick={() => {
                  void copyText(row.detail).then(
                    () => setCopyStatus(m.app_table_copied()),
                    () => setCopyStatus(m.app_table_copy_failed()),
                  )
                }}
              >
                <CopyIcon data-icon="inline-start" />
                {m.app_table_copy()}
              </Button>
            </div>
          </div>
          <ScrollArea className="h-72 bg-[var(--surface-nested)]">
            <pre className="break-words p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
              {row.detail}
            </pre>
          </ScrollArea>
        </TableCell>
      </CollapsibleContent>
    </Collapsible>
  )
}

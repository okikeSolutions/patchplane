import { getLocale } from '@/paraglide/runtime'
import type { WorkflowDetail, WorkflowStartRow } from './types'
import type { WorkflowTrustState } from './workflow-trust-state'
import { workflowTrustStateLabel } from './workflow-trust-state'

export type WorkflowFilter = 'all' | 'needs-review' | 'running' | 'queued'

export interface WorkflowArtifactReference {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly source: string
}

export function sourceLabel(row: WorkflowStartRow) {
  return row.promptRequest.externalRef?.repositoryFullName ?? row.promptRequest.source
}

export function trustStateForList(row: WorkflowStartRow): WorkflowTrustState {
  if (row.workflowRun.status === 'queued') {
    return 'queued'
  }

  if (row.workflowRun.status === 'running') {
    return 'running'
  }

  return 'needs-review'
}

export function lastEventLabel(row: WorkflowStartRow) {
  if (row.workflowRun.status === 'reviewed') {
    return 'Awaiting human decision'
  }

  if (row.workflowRun.status === 'running') {
    return 'Collecting evidence'
  }

  return 'Workflow accepted'
}

export function sandboxSummary(detail: WorkflowDetail) {
  if (detail.sandboxExecutions.length === 0) {
    return 'No sandbox run'
  }

  const latest = detail.sandboxExecutions.at(-1)
  if (latest === undefined) {
    return 'No sandbox run'
  }

  return `${latest.status} · exit ${latest.exitCode ?? 'unknown'}`
}

export function logSummary(detail: WorkflowDetail) {
  const latest = detail.sandboxExecutions.at(-1)
  if (latest === undefined) {
    return detail.runtimeEvents.length === 0
      ? 'No logs recorded'
      : `${detail.runtimeEvents.length} runtime events`
  }

  const streams = [
    latest.stdout.length > 0 ? 'stdout' : undefined,
    latest.stderr !== undefined && latest.stderr.length > 0 ? 'stderr' : undefined,
  ].filter(Boolean)

  return streams.length === 0 ? 'No command output' : streams.join(' + ')
}

export function artifactReferences(detail: WorkflowDetail): ReadonlyArray<WorkflowArtifactReference> {
  const references: Array<WorkflowArtifactReference> = detail.evidenceArtifacts.map((artifact) => ({
    id: artifact.id,
    label: artifact.label ?? artifact.kind,
    value: `${artifact.storageProvider}:${artifact.storageKey}`,
    source: `${artifact.contentType} · ${artifact.sizeBytes} bytes`,
  }))

  for (const event of detail.runtimeEvents) {
    if (event.payloadJson === undefined) {
      continue
    }

    const payload = parsePayload(event.payloadJson)
    if (payload === undefined) {
      continue
    }

    for (const [index, value] of artifactValues(payload).entries()) {
      references.push({
        id: `${event.id}:${index}:${value}`,
        label: event.summary ?? event.type,
        value,
        source: `${event.provider} · ${event.type}`,
      })
    }
  }

  return references
}

export function artifactSummary(detail: WorkflowDetail) {
  const count = artifactReferences(detail).length

  if (count === 0) {
    return 'No artifact refs'
  }

  return count === 1 ? '1 artifact ref' : `${count} artifact refs`
}

export function decisionSummary(state: WorkflowTrustState) {
  if (state === 'approved' || state === 'rejected') {
    return workflowTrustStateLabel(state)
  }

  if (state === 'needs-review') {
    return 'Pending review'
  }

  return 'Untrusted'
}

export function formatRelative(value: number) {
  const deltaSeconds = Math.round((Date.now() - value) / 1000)
  const absolute = Math.abs(deltaSeconds)

  if (absolute < 60) {
    return 'just now'
  }

  const units: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })

  for (const [unit, seconds] of units) {
    if (absolute >= seconds) {
      return formatter.format(-Math.round(deltaSeconds / seconds), unit)
    }
  }

  return formatter.format(-deltaSeconds, 'second')
}

function parsePayload(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function artifactValues(value: unknown): ReadonlyArray<string> {
  if (!isRecord(value)) {
    return []
  }

  const candidates = [
    value.artifactRefs,
    value.artifactReferences,
    value.artifacts,
    value.evidenceArtifacts,
  ]

  return candidates.flatMap((candidate) => valuesFromCandidate(candidate))
}

function valuesFromCandidate(value: unknown): ReadonlyArray<string> {
  if (typeof value === 'string') {
    return [value]
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item === 'string') {
      return [item]
    }

    if (!isRecord(item)) {
      return []
    }

    const referenceValue = item.id ?? item.artifactId ?? item.url ?? item.href ?? item.key

    return typeof referenceValue === 'string' ? [referenceValue] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

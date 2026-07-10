import { Schema } from 'effect'
import type { HumanDecision, PolicyDecision } from './decision-review'
import type { EvidenceArtifact } from './evidence-artifact'
import { ActorId, WorkflowRunId } from './ids'
import type { RuntimeEvent } from './runtime-event'
import type { RuntimeSession } from './runtime-session'
import type { SandboxExecution } from './sandbox-execution'
import type { WorkflowStart } from './workflow-start'

/**
 * Developer-facing trust report for one AI-generated patch attempt.
 *
 * PatchReport is the product primitive: it answers whether a developer has
 * enough evidence to trust or reject the patch before merge.
 */
export const PatchReportStatus = Schema.Literals([
  'pending',
  'verification-passed',
  'verification-failed',
  'approved',
  'rejected',
  'changes-requested',
])
export type PatchReportStatus = Schema.Schema.Type<typeof PatchReportStatus>

export const PatchReportEvidenceKind = Schema.Literals([
  'runtime-event',
  'sandbox-log',
  'stdout',
  'stderr',
  'diff',
  'test-report',
  'screenshot',
  'video',
  'raw-trace',
  'policy-result',
  'trust-report',
])
export type PatchReportEvidenceKind = Schema.Schema.Type<typeof PatchReportEvidenceKind>

export const PatchReportDecisionStatus = Schema.Literals([
  'approved',
  'rejected',
  'changes-requested',
])
export type PatchReportDecisionStatus = Schema.Schema.Type<typeof PatchReportDecisionStatus>

export const PatchReportCheck = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(['passed', 'failed', 'skipped', 'unknown']),
  summary: Schema.optional(Schema.String),
})
export type PatchReportCheck = Schema.Schema.Type<typeof PatchReportCheck>

export const PatchReportEvidence = Schema.Struct({
  kind: PatchReportEvidenceKind,
  label: Schema.String,
  summary: Schema.optional(Schema.String),
  artifactId: Schema.optional(Schema.String),
  artifactUrl: Schema.optional(Schema.String),
})
export type PatchReportEvidence = Schema.Schema.Type<typeof PatchReportEvidence>

export const PatchReportDecision = Schema.Struct({
  status: PatchReportDecisionStatus,
  actorId: ActorId,
  comment: Schema.String,
  decidedAt: Schema.Number,
})
export type PatchReportDecision = Schema.Schema.Type<typeof PatchReportDecision>

export const PatchReport = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  status: PatchReportStatus,
  repository: Schema.optional(Schema.String),
  promptSummary: Schema.String,
  patchSummary: Schema.optional(Schema.String),
  execution: Schema.Struct({
    sandboxProvider: Schema.optional(Schema.String),
    sandboxId: Schema.optional(Schema.String),
    command: Schema.optional(Schema.String),
    status: Schema.Literals(['not-run', 'passed', 'failed', 'running', 'unknown']),
    exitCode: Schema.optional(Schema.Number),
    startedAt: Schema.optional(Schema.Number),
    completedAt: Schema.optional(Schema.Number),
  }),
  checks: Schema.Array(PatchReportCheck),
  evidence: Schema.Array(PatchReportEvidence),
  decision: Schema.optional(PatchReportDecision),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type PatchReport = Schema.Schema.Type<typeof PatchReport>

export const decodePatchReport = Schema.decodeUnknownEffect(PatchReport)
const decodePatchReportSync = Schema.decodeUnknownSync(PatchReport)

export interface AssemblePatchReportV0Input {
  readonly workflowStart: WorkflowStart
  readonly runtimeEvents: ReadonlyArray<RuntimeEvent>
  readonly runtimeSessions: ReadonlyArray<RuntimeSession>
  readonly sandboxExecutions: ReadonlyArray<SandboxExecution>
  readonly evidenceArtifacts?: ReadonlyArray<EvidenceArtifact> | undefined
  readonly policyDecisions?: ReadonlyArray<PolicyDecision> | undefined
  readonly humanDecisions?: ReadonlyArray<HumanDecision> | undefined
}

/**
 * Assembles the first Patch Report read model from already-normalized domain evidence.
 *
 * @remarks
 * This intentionally stays in `packages/domain`: it has no Convex, Cloudflare,
 * Daytona, GitHub, UI, or Alchemy dependency. Storage layers can persist richer
 * read models later, but the product meaning of the report belongs here.
 */
export function assemblePatchReportV0(input: AssemblePatchReportV0Input): PatchReport {
  const latestExecution = latestSandboxExecution(input.sandboxExecutions)
  const latestHumanDecision = latestBy(input.humanDecisions ?? [], (decision) => decision.decidedAt)
  const latestPolicyDecision = latestBy(input.policyDecisions ?? [], (decision) => decision.createdAt)
  const status = patchReportStatus(latestExecution, latestHumanDecision, latestPolicyDecision)
  const updatedAt = latestUpdatedAt(input)

  return decodePatchReportSync({
    id: `patch-report:${input.workflowStart.workflowRun.id}`,
    workflowRunId: input.workflowStart.workflowRun.id,
    status,
    ...optional('repository', input.workflowStart.promptRequest.externalRef?.repositoryFullName),
    promptSummary: summarizeText(input.workflowStart.promptRequest.prompt),
    execution: executionSection(latestExecution),
    checks: checksSection(latestExecution),
    evidence: evidenceSection(input.runtimeEvents, latestExecution, input.evidenceArtifacts ?? []),
    ...decisionSection(latestHumanDecision),
    createdAt: input.workflowStart.workflowRun.createdAt,
    updatedAt,
  })
}

function latestSandboxExecution(
  executions: ReadonlyArray<SandboxExecution>,
): SandboxExecution | undefined {
  return latestBy(executions, (execution) => execution.startedAt)
}

function patchReportStatus(
  latestExecution: SandboxExecution | undefined,
  latestHumanDecision: HumanDecision | undefined,
  latestPolicyDecision: PolicyDecision | undefined,
): PatchReportStatus {
  if (latestHumanDecision !== undefined) {
    return latestHumanDecision.status
  }

  if (
    latestPolicyDecision?.status === 'rejected' ||
    latestPolicyDecision?.status === 'changes-requested'
  ) {
    return 'changes-requested'
  }

  if (latestExecution === undefined) {
    return 'pending'
  }

  return latestExecution.status === 'succeeded'
    ? 'verification-passed'
    : 'verification-failed'
}

function decisionSection(
  latestHumanDecision: HumanDecision | undefined,
): Pick<PatchReport, 'decision'> | object {
  if (latestHumanDecision === undefined) {
    return {}
  }

  return {
    decision: {
      status: latestHumanDecision.status,
      actorId: latestHumanDecision.actorId,
      comment: latestHumanDecision.comment,
      decidedAt: latestHumanDecision.decidedAt,
    },
  }
}

function executionSection(latestExecution: SandboxExecution | undefined): PatchReport['execution'] {
  if (latestExecution === undefined) {
    return { status: 'not-run' }
  }

  return {
    sandboxProvider: latestExecution.provider,
    sandboxId: latestExecution.sandboxId,
    command: latestExecution.command,
    status: latestExecution.status === 'succeeded' ? 'passed' : 'failed',
    ...optional('exitCode', latestExecution.exitCode),
    startedAt: latestExecution.startedAt,
    completedAt: latestExecution.completedAt,
  }
}

function checksSection(latestExecution: SandboxExecution | undefined): ReadonlyArray<PatchReportCheck> {
  if (latestExecution === undefined) {
    return []
  }

  return [
    {
      name: latestExecution.command,
      status: latestExecution.status === 'succeeded' ? 'passed' : 'failed',
      summary: `exit ${latestExecution.exitCode ?? 'unknown'}`,
    },
  ]
}

function evidenceSection(
  runtimeEvents: ReadonlyArray<RuntimeEvent>,
  latestExecution: SandboxExecution | undefined,
  evidenceArtifacts: ReadonlyArray<EvidenceArtifact>,
): ReadonlyArray<PatchReportEvidence> {
  return [
    ...runtimeEvents.map((event): PatchReportEvidence => ({
      kind: 'runtime-event',
      label: event.summary ?? event.type,
      summary: `${event.provider} · ${event.type}`,
    })),
    ...(latestExecution === undefined ? [] : sandboxExecutionEvidence(latestExecution)),
    ...evidenceArtifacts.map((artifact): PatchReportEvidence => ({
      kind: artifact.kind,
      label: artifact.label ?? artifact.kind,
      summary: `${artifact.contentType} · ${artifact.sizeBytes} bytes`,
      artifactId: artifact.id,
    })),
  ]
}

function sandboxExecutionEvidence(execution: SandboxExecution): ReadonlyArray<PatchReportEvidence> {
  return [
    ...(execution.stdout.length === 0 ? [] : [{
      kind: 'stdout' as const,
      label: 'Sandbox stdout',
      summary: `${execution.stdout.length} bytes inline in sandbox execution`,
    }]),
    ...(execution.stderr === undefined || execution.stderr.length === 0 ? [] : [{
      kind: 'stderr' as const,
      label: 'Sandbox stderr',
      summary: `${execution.stderr.length} bytes inline in sandbox execution`,
    }]),
  ]
}

function latestUpdatedAt(input: AssemblePatchReportV0Input) {
  return Math.max(
    input.workflowStart.workflowRun.createdAt,
    input.workflowStart.promptRequest.createdAt,
    ...input.runtimeEvents.map((event) => event.occurredAt),
    ...input.runtimeSessions.map((session) => session.completedAt ?? session.updatedAt),
    ...input.sandboxExecutions.map((execution) => execution.completedAt),
    ...(input.evidenceArtifacts ?? []).map((artifact) => artifact.createdAt),
    ...(input.policyDecisions ?? []).map((decision) => decision.createdAt),
    ...(input.humanDecisions ?? []).map((decision) => decision.decidedAt),
  )
}

function latestBy<A>(
  items: ReadonlyArray<A>,
  value: (item: A) => number,
): A | undefined {
  return items.reduce<A | undefined>(
    (latest, item) =>
      latest === undefined || value(item) > value(latest) ? item : latest,
    undefined,
  )
}

function summarizeText(value: string) {
  const collapsed = value.trim().replace(/\s+/g, ' ')
  return collapsed.length <= 240 ? collapsed : `${collapsed.slice(0, 237)}...`
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Value extends undefined ? Record<Key, never> : Partial<Record<Key, Value>> {
  return value === undefined ? {} as never : { [key]: value } as never
}

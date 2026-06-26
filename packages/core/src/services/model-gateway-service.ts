import { Context, Effect, type Redacted } from 'effect'
import type { ModelGatewayError } from '@patchplane/domain/errors'
import type { TelemetryContextFields } from './telemetry-service'

export interface ModelSelectionInput extends TelemetryContextFields {
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly traceId?: string | undefined
  readonly workflowRunId?: string | undefined
}

export interface ModelGatewayProvenanceMetadata {
  readonly gatewayProvider: string
  readonly provider: string
  readonly model: string
  readonly gatewayId?: string | undefined
  readonly accountId?: string | undefined
  readonly baseUrl?: string | undefined
  readonly directProviderFallback: boolean
}

export type ModelGatewayPublicEnvironment = Readonly<Record<string, string>>
export type ModelGatewaySecretEnvironment = Readonly<Record<string, Redacted.Redacted>>

export interface ModelGatewayAccess {
  readonly provider: string
  readonly model: string
  /** Runtime-only non-secret environment values. */
  readonly publicEnvironment?: ModelGatewayPublicEnvironment | undefined
  /** Runtime-only secret environment values. Callers must unwrap only at the final trusted runtime boundary. */
  readonly secretEnvironment?: ModelGatewaySecretEnvironment | undefined
  readonly provenance: ModelGatewayProvenanceMetadata
}

export interface ModelGatewayValidationResult {
  readonly provider: string
  readonly model: string
  readonly supported: boolean
  readonly reason?: string | undefined
}

/** Model access configuration boundary for runtime plugins. */
export class ModelGatewayService extends Context.Service<ModelGatewayService, {
  readonly resolveModelAccess: (
    input: ModelSelectionInput,
  ) => Effect.Effect<ModelGatewayAccess, ModelGatewayError>
  readonly validateModelSelection: (
    input: ModelSelectionInput,
  ) => Effect.Effect<ModelGatewayValidationResult, ModelGatewayError>
  readonly getProvenanceMetadata: (
    input: ModelSelectionInput,
  ) => Effect.Effect<ModelGatewayProvenanceMetadata, ModelGatewayError>
}>()('@patchplane/core/services/ModelGatewayService') {}

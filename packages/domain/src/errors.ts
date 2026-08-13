import { Schema } from 'effect'

export class AuthError extends Schema.TaggedError<AuthError>()(
  'AuthError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class StorageError extends Schema.TaggedError<StorageError>()(
  'StorageError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class GitHubError extends Schema.TaggedError<GitHubError>()(
  'GitHubError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class SourceControlError
  extends Schema.TaggedError<SourceControlError>()('SourceControlError', {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  }) {}

export class SandboxError extends Schema.TaggedError<SandboxError>()(
  'SandboxError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class ArtifactsError extends Schema.TaggedError<ArtifactsError>()(
  'ArtifactsError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class TelemetryError extends Schema.TaggedError<TelemetryError>()(
  'TelemetryError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class WorkflowStateError
  extends Schema.TaggedError<WorkflowStateError>()('WorkflowStateError', {
    message: Schema.String,
  }) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  'ValidationError',
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export function publicErrorMessage(
  cause: unknown,
  fallback = 'Operation failed',
  seen = new WeakSet(),
): string {
  if (typeof cause === 'object' && cause !== null) {
    if (seen.has(cause)) {
      return fallback
    }
    seen.add(cause)
  }

  const messageValue: unknown = typeof cause === 'object' && cause !== null
    ? Reflect.get(cause, 'message')
    : undefined
  const nameValue: unknown = typeof cause === 'object' && cause !== null
    ? Reflect.get(cause, 'name')
    : undefined
  const tagValue: unknown = typeof cause === 'object' && cause !== null
    ? Reflect.get(cause, '_tag')
    : undefined
  const nestedCause: unknown = typeof cause === 'object' && cause !== null
    ? Reflect.get(cause, 'cause')
    : undefined
  const message = cause instanceof Error
    ? cause.message
    : typeof messageValue === 'string'
    ? messageValue
    : undefined
  const name = typeof nameValue === 'string' ? nameValue : undefined
  const tag = typeof tagValue === 'string' ? tagValue : undefined
  const nestedMessage = nestedCause === undefined
    ? undefined
    : publicErrorMessage(nestedCause, fallback, seen)

  if (tag === 'ConfigError') {
    return 'PatchPlane server configuration is incomplete. Check CONVEX_URL or VITE_CONVEX_URL and WorkOS server environment variables.'
  }

  if (message && nestedMessage && nestedMessage !== fallback) {
    return `${message}: ${nestedMessage}`
  }

  if (message) {
    return message
  }

  if (name || tag) {
    return [name, tag].filter(Boolean).join(': ')
  }

  return fallback
}

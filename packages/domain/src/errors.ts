import { Schema } from 'effect'

export class AuthError extends Schema.TaggedErrorClass<AuthError>()(
  'AuthError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  'StorageError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class GitHubError extends Schema.TaggedErrorClass<GitHubError>()(
  'GitHubError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class SourceControlError
  extends Schema.TaggedErrorClass<SourceControlError>()('SourceControlError', {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  }) {}

export class WorkflowStateError
  extends Schema.TaggedErrorClass<WorkflowStateError>()('WorkflowStateError', {
    message: Schema.String,
  }) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  'ValidationError',
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

function property(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  return Reflect.get(value, key)
}

function stringProperty(value: unknown, key: string) {
  const item = property(value, key)
  return typeof item === 'string' ? item : undefined
}

function causeProperty(value: unknown) {
  return property(value, 'cause')
}

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

  const message = cause instanceof Error ? cause.message : stringProperty(cause, 'message')
  const name = stringProperty(cause, 'name')
  const tag = stringProperty(cause, '_tag')
  const nestedCause = causeProperty(cause)
  const nestedMessage =
    nestedCause === undefined
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

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

import { Schema } from 'effect'

export const ServerFunctionContext = Schema.Struct({
  traceId: Schema.String,
  operation: Schema.String,
})
export type ServerFunctionContext = Schema.Schema.Type<
  typeof ServerFunctionContext
>

export const ServerFunctionFailure = Schema.Struct({
  ok: Schema.Literal(false),
  traceId: Schema.String,
  error: Schema.String,
})
export type ServerFunctionFailure = Schema.Schema.Type<
  typeof ServerFunctionFailure
>

export type ServerFunctionResult<Success extends object, Failure extends object> =
  | ({ readonly ok: true } & Success)
  | ({ readonly ok: false; readonly traceId: string } & Failure)

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

export const PiRpcCommandResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.Literal('response'),
  command: Schema.String,
  success: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
})
export type PiRpcCommandResponse = Schema.Schema.Type<typeof PiRpcCommandResponse>

const OptionalIdPayload = { id: Schema.optional(Schema.String) } as const
const MessagePayload = {
  id: Schema.optional(Schema.String),
  message: Schema.String,
} as const

/**
 * Typed PatchPlane-side contract for Pi RPC commands.
 *
 * Pi itself still speaks its native JSONL protocol. This RpcGroup is the clean
 * internal API used by transports that know how to translate Effect RPC
 * requests to Pi JSONL commands.
 */
export const PiRpcs = RpcGroup.make(
  Rpc.make('get_state', {
    payload: OptionalIdPayload,
    success: PiRpcCommandResponse,
    error: Schema.String,
  }),
  Rpc.make('prompt', {
    payload: MessagePayload,
    success: PiRpcCommandResponse,
    error: Schema.String,
  }),
  Rpc.make('steer', {
    payload: MessagePayload,
    success: PiRpcCommandResponse,
    error: Schema.String,
  }),
  Rpc.make('follow_up', {
    payload: MessagePayload,
    success: PiRpcCommandResponse,
    error: Schema.String,
  }),
  Rpc.make('abort', {
    payload: OptionalIdPayload,
    success: PiRpcCommandResponse,
    error: Schema.String,
  }),
)

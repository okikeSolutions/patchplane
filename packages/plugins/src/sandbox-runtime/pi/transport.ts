import { Effect } from 'effect'
import { RpcClient } from 'effect/unstable/rpc'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type { FromClient } from 'effect/unstable/rpc/RpcMessage'
import { PiRpcs } from './contract'

type PiRpcCommand =
  | { readonly id?: string | undefined; readonly type: 'prompt'; readonly message: string }
  | { readonly id?: string | undefined; readonly type: 'steer'; readonly message: string }
  | { readonly id?: string | undefined; readonly type: 'follow_up'; readonly message: string }
  | { readonly id?: string | undefined; readonly type: 'abort' }
  | { readonly id?: string | undefined; readonly type: 'get_state' }

function encodePiRpcCommand(command: PiRpcCommand) {
  return `${JSON.stringify(command)}\n`
}

function optionalId(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return {}
  const id = Reflect.get(payload, 'id')
  return typeof id === 'string' ? { id } : {}
}

type PiEffectRequest = Extract<FromClient<any>, { readonly _tag: 'Request' }>

function isPiEffectRequest(message: FromClient<any>): message is PiEffectRequest {
  return Reflect.get(message, '_tag') === 'Request'
}

function piCommandFromEffectRequest(message: FromClient<any>): PiRpcCommand | undefined {
  if (!isPiEffectRequest(message)) return undefined
  const payload = message.payload

  switch (message.tag) {
    case 'get_state':
      return { ...optionalId(payload), type: 'get_state' }
    case 'abort':
      return { ...optionalId(payload), type: 'abort' }
    case 'prompt':
    case 'steer':
    case 'follow_up': {
      const text = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'message') : undefined
      if (typeof text !== 'string') return undefined
      return { ...optionalId(payload), type: message.tag, message: text }
    }
    default:
      return undefined
  }
}

export interface PiRpcCommandTransport<E = never> {
  readonly sendInput: (data: string) => Effect.Effect<void, E>
}

export interface PiRpcCommandSender {
  readonly getState: (input?: { readonly id?: string | undefined }) => Effect.Effect<void>
  readonly prompt: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void>
  readonly steer: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void>
  readonly followUp: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void>
  readonly abort: (input?: { readonly id?: string | undefined }) => Effect.Effect<void>
}

/**
 * Builds a command sender backed by Effect RPC. Calls are intentionally issued
 * with `discard: true`: Pi acknowledges commands asynchronously on stdout, and
 * those responses are consumed by the runtime-event ingestion stream.
 */
export function makePiRpcCommandSender<E>(transport: PiRpcCommandTransport<E>): PiRpcCommandSender {
  const runDiscard = (
    f: (client: any) => Effect.Effect<void, RpcClientError | E>,
  ): Effect.Effect<void> =>
    Effect.scoped(Effect.gen(function* () {
      const made = yield* RpcClient.makeNoSerialization(PiRpcs, {
        supportsAck: false,
        disableTracing: true,
        onFromClient: ({ message }) => {
          const command = piCommandFromEffectRequest(message)
          return command === undefined ? Effect.void : transport.sendInput(encodePiRpcCommand(command))
        },
      })
      return yield* f(made.client).pipe(Effect.orDie)
    }))

  return {
    getState: (input = {}) => runDiscard((client) => client.get_state(input, { discard: true })),
    prompt: (input) => runDiscard((client) => client.prompt(input, { discard: true })),
    steer: (input) => runDiscard((client) => client.steer(input, { discard: true })),
    followUp: (input) => runDiscard((client) => client.follow_up(input, { discard: true })),
    abort: (input = {}) => runDiscard((client) => client.abort(input, { discard: true })),
  }
}

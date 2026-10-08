import { Effect, Match } from 'effect'
import { RpcClient } from 'effect/rpc'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type { FromClient } from 'effect/rpc/RpcMessage'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import { PiRpcs } from './contract'

type PiRpcCommand =
  | {
      readonly id?: string | undefined
      readonly type: 'prompt'
      readonly message: string
    }
  | {
      readonly id?: string | undefined
      readonly type: 'steer'
      readonly message: string
    }
  | {
      readonly id?: string | undefined
      readonly type: 'follow_up'
      readonly message: string
    }
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

type PiRpcDefinitions = RpcGroup.Rpcs<typeof PiRpcs>
type PiEffectRequest = Extract<
  FromClient<PiRpcDefinitions>,
  { readonly _tag: 'Request' }
>
type PiRpcClient<E> = RpcClient.RpcClient<PiRpcDefinitions, E>

function isPiEffectRequest(
  message: FromClient<PiRpcDefinitions>,
): message is PiEffectRequest {
  return Reflect.get(message, '_tag') === 'Request'
}

function commandWithMessage(
  type: 'prompt' | 'steer' | 'follow_up',
  payload: unknown,
): PiRpcCommand | undefined {
  const text =
    typeof payload === 'object' && payload !== null
      ? Reflect.get(payload, 'message')
      : undefined
  return typeof text === 'string'
    ? { ...optionalId(payload), type, message: text }
    : undefined
}

function piCommandFromEffectRequest(
  message: FromClient<PiRpcDefinitions>,
): PiRpcCommand | undefined {
  if (!isPiEffectRequest(message)) return undefined
  const payload = message.payload

  return Match.value(message.tag).pipe(
    Match.when('get_state', () => ({
      ...optionalId(payload),
      type: 'get_state' as const,
    })),
    Match.when('abort', () => ({
      ...optionalId(payload),
      type: 'abort' as const,
    })),
    Match.when('prompt', () => commandWithMessage('prompt', payload)),
    Match.when('steer', () => commandWithMessage('steer', payload)),
    Match.when('follow_up', () => commandWithMessage('follow_up', payload)),
    Match.orElse(() => undefined),
  )
}

export interface PiRpcCommandTransport<E = never> {
  readonly sendInput: (data: string) => Effect.Effect<void, E>
}

export interface PiRpcCommandSender<E = never> {
  readonly getState: (input?: {
    readonly id?: string | undefined
  }) => Effect.Effect<void, RpcClientError | E>
  readonly prompt: (input: {
    readonly id?: string | undefined
    readonly message: string
  }) => Effect.Effect<void, RpcClientError | E>
  readonly steer: (input: {
    readonly id?: string | undefined
    readonly message: string
  }) => Effect.Effect<void, RpcClientError | E>
  readonly followUp: (input: {
    readonly id?: string | undefined
    readonly message: string
  }) => Effect.Effect<void, RpcClientError | E>
  readonly abort: (input?: {
    readonly id?: string | undefined
  }) => Effect.Effect<void, RpcClientError | E>
}

/**
 * Builds a command sender backed by Effect RPC. Calls are intentionally issued
 * with `discard: true`: Pi acknowledges commands asynchronously on stdout, and
 * those responses are consumed by the runtime-event ingestion stream.
 */
export function makePiRpcCommandSender<E>(
  transport: PiRpcCommandTransport<E>,
): PiRpcCommandSender<E> {
  const runDiscard = (
    f: (client: PiRpcClient<E>) => Effect.Effect<void, RpcClientError | E>,
  ): Effect.Effect<void, RpcClientError | E> =>
    Effect.scoped(
      Effect.gen(function* () {
        const made = yield* RpcClient.makeNoSerialization(PiRpcs, {
          supportsAck: false,
          disableTracing: true,
          onFromClient: ({ message }) => {
            const command = piCommandFromEffectRequest(message)
            return command === undefined
              ? Effect.void
              : transport.sendInput(encodePiRpcCommand(command))
          },
        })
        return yield* f(made.client)
      }),
    )

  return {
    getState: (input = {}) =>
      runDiscard((client) => client.get_state(input, { discard: true })),
    prompt: (input) =>
      runDiscard((client) => client.prompt(input, { discard: true })),
    steer: (input) =>
      runDiscard((client) => client.steer(input, { discard: true })),
    followUp: (input) =>
      runDiscard((client) => client.follow_up(input, { discard: true })),
    abort: (input = {}) =>
      runDiscard((client) => client.abort(input, { discard: true })),
  }
}

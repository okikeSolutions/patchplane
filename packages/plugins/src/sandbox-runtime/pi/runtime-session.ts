import { Stream, type Effect } from 'effect'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import { makePiRpcCommandSender } from './transport'
import { decodePiRpcRuntimeEvents, type PiRpcRuntimeEvent } from './ingestion'

export interface PiRuntimeSession<EventError = never, CommandError = never, R = never> {
  readonly sourceSessionId: string
  readonly sourceCommandId: string
  readonly events: Stream.Stream<PiRpcRuntimeEvent, EventError, R>
  readonly getState: (input?: { readonly id?: string | undefined }) => Effect.Effect<void, CommandError>
  readonly prompt: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void, CommandError>
  readonly steer: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void, CommandError>
  readonly followUp: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void, CommandError>
  readonly abort: (input?: { readonly id?: string | undefined }) => Effect.Effect<void, CommandError>
}

export function makePiRuntimeSession<EventError, CommandError, R>(input: {
  readonly sessionId: string
  readonly commandId: string
  readonly stdout: Stream.Stream<string, EventError, R>
  readonly sendInput: (data: string) => Effect.Effect<void, CommandError>
  readonly now: () => number
}): PiRuntimeSession<EventError, RpcClientError | CommandError, R> {
  const sender = makePiRpcCommandSender({ sendInput: input.sendInput })
  return {
    sourceSessionId: input.sessionId,
    sourceCommandId: input.commandId,
    events: input.stdout.pipe(decodePiRpcRuntimeEvents({
      sessionId: input.sessionId,
      commandId: input.commandId,
      stream: 'stdout',
      now: input.now,
    })),
    getState: sender.getState,
    prompt: sender.prompt,
    steer: sender.steer,
    followUp: sender.followUp,
    abort: sender.abort,
  }
}

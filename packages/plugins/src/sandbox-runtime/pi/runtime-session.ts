import { Stream, type Effect } from 'effect'
import { makePiRpcCommandSender } from './transport'
import { decodePiRpcRuntimeEvents, type PiRpcRuntimeEvent } from './ingestion'

export interface PiRuntimeSession<E = never, R = never> {
  readonly sourceSessionId: string
  readonly sourceCommandId: string
  readonly events: Stream.Stream<PiRpcRuntimeEvent, E, R>
  readonly getState: (input?: { readonly id?: string | undefined }) => Effect.Effect<void>
  readonly prompt: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void>
  readonly steer: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void>
  readonly followUp: (input: { readonly id?: string | undefined; readonly message: string }) => Effect.Effect<void>
  readonly abort: (input?: { readonly id?: string | undefined }) => Effect.Effect<void>
}

export function makePiRuntimeSession<E, R>(input: {
  readonly sessionId: string
  readonly commandId: string
  readonly stdout: Stream.Stream<string, E, R>
  readonly sendInput: (data: string) => Effect.Effect<void, unknown>
  readonly now?: (() => number) | undefined
}): PiRuntimeSession<E, R> {
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

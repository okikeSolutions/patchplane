export function combineAbortSignals(
  signals: ReadonlyArray<AbortSignal | null | undefined>,
): AbortSignal {
  return AbortSignal.any(signals.filter((signal) => signal != null))
}

export function fetchWithSignal(signal: AbortSignal): typeof globalThis.fetch {
  return ((input, init) =>
    globalThis.fetch(input, {
      ...init,
      signal: combineAbortSignals([
        signal,
        input instanceof Request ? input.signal : undefined,
        init?.signal,
      ]),
    })) as typeof globalThis.fetch
}

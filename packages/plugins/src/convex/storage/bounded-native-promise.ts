import { StorageError } from '@patchplane/domain/errors'

export function settleConvexMutation<T>(input: {
  readonly operation: (signal: AbortSignal) => Promise<T>
  readonly operationName: string
  readonly timeoutMilliseconds?: number | undefined
}): Promise<T> {
  const deadline = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (complete: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      complete()
    }
    const timer = setTimeout(
      () =>
        settle(() => {
          deadline.abort('Convex mutation deadline exceeded')
          reject(
            new StorageError({
              operation: input.operationName,
              message: 'Convex mutation did not settle before its deadline',
              cause: undefined,
            }),
          )
        }),
      input.timeoutMilliseconds ?? 15_000,
    )
    void input.operation(deadline.signal).then(
      (value) => settle(() => resolve(value)),
      (cause) => settle(() => reject(cause)),
    )
  })
}

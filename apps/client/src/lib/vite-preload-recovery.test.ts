import { describe, expect, test, vi } from 'vitest'
import { installVitePreloadErrorRecovery } from './vite-preload-recovery'

function recoveryTarget() {
  const values = new Map<string, string>()
  const reload = vi.fn()
  let listener: EventListener | undefined
  const target = {
    addEventListener: (_type: string, nextListener: EventListener) => {
      listener = nextListener
    },
    removeEventListener: (_type: string, nextListener: EventListener) => {
      if (listener === nextListener) listener = undefined
    },
    dispatchEvent: (event: Event) => listener?.(event),
    location: { reload },
    sessionStorage: {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key)
      },
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    },
  }
  return { reload, target }
}

describe('Vite preload recovery', () => {
  test('prevents the stale-chunk error and reloads once', () => {
    const { reload, target } = recoveryTarget()
    const remove = installVitePreloadErrorRecovery(target, () => 1_000)
    const firstError = new Event('vite:preloadError', { cancelable: true })
    const repeatedError = new Event('vite:preloadError', { cancelable: true })
    const preventFirstError = vi.spyOn(firstError, 'preventDefault')
    const preventRepeatedError = vi.spyOn(repeatedError, 'preventDefault')

    target.dispatchEvent(firstError)
    target.dispatchEvent(repeatedError)

    expect(preventFirstError).toHaveBeenCalledTimes(1)
    expect(preventRepeatedError).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)

    remove()
  })
})

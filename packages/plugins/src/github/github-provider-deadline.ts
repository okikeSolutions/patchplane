const githubProviderDeadlineMilliseconds = 10_000

export function githubProviderDeadlineSignal(
  effectSignal: AbortSignal,
  timeoutMilliseconds = githubProviderDeadlineMilliseconds,
) {
  return AbortSignal.any([
    effectSignal,
    AbortSignal.timeout(timeoutMilliseconds),
  ])
}

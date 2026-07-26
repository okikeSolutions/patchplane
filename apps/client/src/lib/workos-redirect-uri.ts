const callbackPath = '/api/auth/callback'

function validateRedirectUri(candidate: URL) {
  if (
    (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') ||
    candidate.username !== '' ||
    candidate.password !== '' ||
    candidate.pathname !== callbackPath ||
    candidate.search !== '' ||
    candidate.hash !== ''
  ) {
    throw new Error(
      `WORKOS_REDIRECT_URI must be an HTTP(S) URL whose path is exactly ${callbackPath}`,
    )
  }

  return candidate.toString()
}

export function resolveWorkOSRedirectUri(
  request: Request,
  configuredRedirectUri?: string,
) {
  const configured = configuredRedirectUri?.trim()
  const candidate = configured
    ? new URL(configured)
    : new URL(callbackPath, request.url)

  return validateRedirectUri(candidate)
}

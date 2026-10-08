import { handleTunnelRequest } from '@sentry/core'

export function forwardSentryTunnelEnvelope(
  request: Request,
  allowedDsn: string | undefined,
): Promise<Response> {
  return handleTunnelRequest({
    request,
    allowedDsns: allowedDsn === undefined ? [] : [allowedDsn],
  })
}

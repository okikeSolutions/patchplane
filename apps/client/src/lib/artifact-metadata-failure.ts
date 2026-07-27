export type ArtifactMetadataFailureCode =
  | 'artifact_authorization_required'
  | 'artifact_metadata_unavailable'
  | 'authentication_required'

const authenticationMarkers = ['Authentication required'] as const
const authorizationMarkers = [
  'Active WorkOS organization required',
  'Active membership required',
  'Permission required',
  'Workspace mismatch',
  'WorkOS workspace required',
] as const

export function artifactMetadataFailureCode(
  cause: unknown,
): ArtifactMetadataFailureCode {
  const description = describeCause(cause)
  if (authenticationMarkers.some((marker) => description.includes(marker))) {
    return 'authentication_required'
  }
  if (authorizationMarkers.some((marker) => description.includes(marker))) {
    return 'artifact_authorization_required'
  }
  return 'artifact_metadata_unavailable'
}

function describeCause(cause: unknown, depth = 0): string {
  if (depth > 3) return ''
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) {
    return `${cause.name} ${cause.message} ${describeCause(cause.cause, depth + 1)}`
  }
  if (typeof cause !== 'object' || cause === null) return ''
  const record = cause as Readonly<Record<string, unknown>>
  return [
    typeof record.message === 'string' ? record.message : '',
    typeof record.data === 'string' ? record.data : '',
    describeCause(record.cause, depth + 1),
  ].join(' ')
}

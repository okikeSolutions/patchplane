import { getAuth } from '@workos/authkit-tanstack-react-start'
import { mapWorkOSSessionToAuthRequest } from '@patchplane/plugins/workos/session'

export async function getWorkOSAuthRequest() {
  const auth = await getAuth()

  if (!auth.user) {
    return mapWorkOSSessionToAuthRequest({ user: null })
  }

  return mapWorkOSSessionToAuthRequest({
    user: auth.user,
    sessionId: auth.sessionId,
    organizationId: auth.organizationId,
    role: auth.role,
    roles: auth.roles,
    permissions: auth.permissions,
    accessToken: auth.accessToken,
  })
}

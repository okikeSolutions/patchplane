import { createServerFn } from '@tanstack/react-start'

export const getInitialAuthServerFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getAuth } = await import('@workos/authkit-tanstack-react-start')
    return getAuth()
  },
)

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/callback')({
  server: {
    handlers: {
      GET: async (args) => {
        const { handleCallbackRoute } =
          await import('@workos/authkit-tanstack-react-start')

        return handleCallbackRoute({
          errorRedirectUrl: '/?auth=failed',
        })(args)
      },
    },
  },
})

import { createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexProviderWithAuthKit } from '@convex-dev/workos'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import { deLocalizeUrl, localizeUrl } from './paraglide/runtime'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL!
  const WORKOS_CLIENT_ID = (import.meta as any).env.VITE_WORKOS_CLIENT_ID!
  const WORKOS_REDIRECT_URI = (import.meta as any).env.VITE_WORKOS_REDIRECT_URI!

  if (!CONVEX_URL) {
    console.error('missing envar VITE_CONVEX_URL')
  }
  if (!WORKOS_CLIENT_ID) {
    console.error('missing envar VITE_WORKOS_CLIENT_ID')
  }
  if (!WORKOS_REDIRECT_URI) {
    console.error('missing envar VITE_WORKOS_REDIRECT_URI')
  }

  const convexQueryClient = new ConvexQueryClient(CONVEX_URL)

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = routerWithQueryClient(
    createRouter({
      routeTree,
      defaultPreload: 'intent',
      context: { queryClient },
      scrollRestoration: true,
      rewrite: {
        input: ({ url }) => deLocalizeUrl(url),
        output: ({ url }) => localizeUrl(url),
      },
      Wrap: ({ children }) => (
        <AuthKitProvider
          clientId={WORKOS_CLIENT_ID}
          redirectUri={WORKOS_REDIRECT_URI}
        >
          <ConvexProviderWithAuthKit
            client={convexQueryClient.convexClient}
            useAuth={useAuth}
          >
            {children}
          </ConvexProviderWithAuthKit>
        </AuthKitProvider>
      ),
    }),
    queryClient,
  )

  return router
}

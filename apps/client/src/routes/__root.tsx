import { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext } from '@tanstack/react-router'
import { HeadContent, Scripts } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import Footer from '@/components/footer'
import Header from '@/components/header'
import { ThemeProvider } from '@/components/theme-provider'
import appCss from '../styles.css?url'
import { cn } from '@/lib/utils'
import { getThemeServerFn } from '@/lib/theme'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: m.meta_title(),
      },
      {
        name: 'description',
        content: m.meta_description(),
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  loader: () => getThemeServerFn(),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const theme = Route.useLoaderData()

  return (
    <html
      lang={getLocale()}
      className={cn('scroll-smooth', theme)}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen wrap-anywhere bg-background bg-[radial-gradient(circle_at_top_left,var(--hero-glow),transparent_30rem),radial-gradient(circle_at_85%_15%,var(--hero-glow-soft),transparent_24rem),linear-gradient(180deg,rgb(255_255_255/0.02),transparent_28rem)] bg-fixed font-sans text-foreground antialiased selection:bg-primary/28">
        <ThemeProvider theme="dark">
          <Header />
          {children}
          <Footer />
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
          <Scripts />
        </ThemeProvider>
      </body>
    </html>
  )
}

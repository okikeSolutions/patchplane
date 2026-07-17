import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import Footer from '@/components/footer'
import Header from '@/components/header'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import appCss from '../../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: m.meta_title() },
      { name: 'description', content: m.meta_description() },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/brand/patchplane-favicon-light.svg',
        media: '(prefers-color-scheme: light)',
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/brand/patchplane-favicon-dark.svg',
        media: '(prefers-color-scheme: dark)',
      },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),
  shellComponent: LandingDocument,
})

function LandingDocument({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang={getLocale()} className="scroll-smooth dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen wrap-anywhere bg-background bg-[radial-gradient(circle_at_top_left,var(--hero-glow),transparent_30rem),radial-gradient(circle_at_85%_15%,var(--hero-glow-soft),transparent_24rem),linear-gradient(180deg,rgb(255_255_255/0.02),transparent_28rem)] bg-fixed font-sans text-foreground antialiased selection:bg-primary/28">
        <ThemeProvider theme="dark" persistence="local">
          <TooltipProvider>
            <Header showSignIn={false} />
            {children}
            <Footer />
          </TooltipProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

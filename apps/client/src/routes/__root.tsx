import { useCallback, useMemo } from "react";
import { QueryClient } from "@tanstack/react-query";
import { type AuthTokenFetcher } from "convex/react";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos/authkit-tanstack-react-start/client";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import * as m from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import Footer from "@/components/footer";
import Header from "@/components/header";
import { ThemeProvider } from "@/components/theme-provider";
import appCss from "../styles.css?url";
import { cn } from "@/lib/utils";
import { getThemeServerFn } from "@/lib/theme";
import { getInitialAuthServerFn } from "@/lib/workos-initial-auth";
import { TooltipProvider } from "@/components/ui/tooltip";

interface ConvexAuthClient {
  setAuth(fetchToken: AuthTokenFetcher): void;
  clearAuth(): void;
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexAuthClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: m.meta_title(),
      },
      {
        name: "description",
        content: m.meta_description(),
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  loader: async () => ({
    theme: await getThemeServerFn(),
    initialAuth: await getInitialAuthServerFn(),
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const { convexClient } = Route.useRouteContext();
  const { theme, initialAuth } = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const locale = getLocale();
  const isAppShellRoute = pathname.startsWith('/app');

  return (
    <html
      lang={locale}
      className={cn("scroll-smooth", theme)}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen wrap-anywhere bg-background bg-[radial-gradient(circle_at_top_left,var(--hero-glow),transparent_30rem),radial-gradient(circle_at_85%_15%,var(--hero-glow-soft),transparent_24rem),linear-gradient(180deg,rgb(255_255_255/0.02),transparent_28rem)] bg-fixed font-sans text-foreground antialiased selection:bg-primary/28">
        <ThemeProvider theme={theme}>
          <TooltipProvider>
            <AuthKitProvider initialAuth={initialAuth}>
              <ConvexProviderWithAuthKit
                client={convexClient}
                useAuth={useConvexAuthFromWorkOS}
              >
                {isAppShellRoute ? null : <Header />}
                <div key={locale}>{children}</div>
                {isAppShellRoute ? null : <Footer />}
              </ConvexProviderWithAuthKit>
            </AuthKitProvider>
            <TanStackDevtools
              config={{
                position: "bottom-right",
              }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
            <Scripts />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

function useConvexAuthFromWorkOS() {
  const auth = useAuth();
  const { getAccessToken } = useAccessToken();
  const getConvexAccessToken = useCallback(
    async () => (await getAccessToken()) ?? null,
    [getAccessToken],
  );

  return useMemo(
    () => ({
      isLoading: auth.loading,
      isAuthenticated: auth.user !== null,
      user: auth.user,
      getAccessToken: getConvexAccessToken,
    }),
    [auth.loading, auth.user, getConvexAccessToken],
  );
}

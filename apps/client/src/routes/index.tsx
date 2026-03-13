import { Link, createFileRoute } from '@tanstack/react-router'
import { coreCapabilities } from '@patchplane/domain'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <Card className="hero-panel rise-in relative overflow-hidden rounded-4xl border-0 px-2 py-6 shadow-none sm:px-6 sm:py-8">
        <CardHeader className="relative max-w-4xl gap-3">
          <Badge variant="secondary" className="island-kicker">
            Initial scaffold
          </Badge>
          <CardTitle className="display-title max-w-4xl text-4xl leading-[0.98] font-bold tracking-tight sm:text-6xl">
            One control plane.
            <br />
            One shared UI.
            <br />
            Clear runtime boundaries.
          </CardTitle>
          <CardDescription className="max-w-3xl text-base sm:text-lg">
            PatchPlane starts with a single TanStack Start client, a
            Convex-backed control-plane package, and a small shared domain
            model. The landing lives at <code>/</code>. The product shell lives
            at <code>/app</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative flex flex-wrap gap-3">
          <Link
            to="/app"
            className={buttonVariants({
              size: 'lg',
              className:
                'rounded-full border border-primary/25 bg-primary/12 hover:-translate-y-0.5',
            })}
          >
            Open Product Shell
          </Link>
          <Link
            to="/about"
            className={buttonVariants({
              variant: 'outline',
              size: 'lg',
              className:
                'rounded-full bg-white/50 hover:-translate-y-0.5 hover:border-primary/25',
            })}
          >
            View Architecture Notes
          </Link>
          <a
            href="https://tanstack.com/start/latest/docs/framework/react/overview"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: 'outline',
              size: 'lg',
              className:
                'rounded-full bg-white/50 hover:-translate-y-0.5 hover:border-primary/25',
            })}
          >
            TanStack Start Docs
          </a>
        </CardContent>
      </Card>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {coreCapabilities.map((capability, index) => (
          <Card
            key={capability.name}
            className="island-shell feature-card rise-in rounded-2xl py-5"
            style={{ animationDelay: `${index * 90 + 80}ms` }}
          >
            <CardHeader className="gap-2">
              <CardTitle className="text-base font-semibold">
                {capability.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">
                {capability.summary}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="island-shell rounded-2xl py-6">
          <CardHeader className="gap-2">
            <Badge variant="outline" className="island-kicker">
              Scaffold decisions
            </Badge>
          </CardHeader>
          <CardContent>
            <ul className="m-0 list-disc space-y-2 pl-5 text-sm">
              <li>One TanStack Start app owns both landing and product UI.</li>
              <li>
                `packages/backend` owns Convex plus internal runtime and sandbox
                boundaries.
              </li>
              <li>`packages/domain` holds shared types and Effect schemas.</li>
              <li>
                Additional packages can be extracted later once the first
                runtime loop is real.
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-border bg-muted py-6">
          <CardHeader className="gap-2">
            <Badge variant="outline" className="island-kicker">
              Next step
            </Badge>
          </CardHeader>
          <CardContent>
            <CardDescription className="text-sm">
              Wire one request mutation, one fake run action, and one event feed
              from Convex before adding Daytona, Pi Mono, or a desktop shell.
            </CardDescription>
          </CardContent>
        </Card>
      </section>

      <Card className="island-shell mt-8 rounded-2xl py-6 border-border">
        <CardHeader className="gap-2">
          <Badge variant="outline" className="island-kicker">
            Workspace commands
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Separator />
          <ul className="m-0 list-disc space-y-2 pl-5 text-sm">
            <li>
              <code>bun install</code> at the repository root
            </li>
            <li>
              <code>bun run dev:client</code> to start the TanStack Start app
            </li>
            <li>
              <code>bun run dev:backend</code> to start Convex from{' '}
              <code>packages/backend</code>
            </li>
          </ul>
        </CardContent>
      </Card>
    </main>
  )
}

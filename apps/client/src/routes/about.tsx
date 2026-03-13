import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="page-wrap px-4 pb-10 pt-14">
      <Card className="island-shell rise-in rounded-4xl py-6 sm:py-8">
        <CardHeader className="gap-3 px-6 sm:px-10">
          <Badge variant="secondary" className="island-kicker">
            Architecture notes
          </Badge>
          <CardTitle className="display-title text-4xl font-bold tracking-tight sm:text-5xl">
            Keep the workspace small until the execution loop is proven.
          </CardTitle>
          <CardDescription className="max-w-2xl text-base sm:text-lg">
            The PatchPlane keeps the runtime and sandbox boundaries explicit
            without prematurely extracting every concept into its own workspace
            package.
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {[
          {
            title: 'Shared UI first',
            desc: 'The same TanStack Start app serves the landing at / and the product shell at /app.',
          },
          {
            title: 'Backend owns Convex',
            desc: 'Convex lives in packages/backend so the control plane has a single backend root.',
          },
          {
            title: 'Extract later',
            desc: 'Runtime adapters, sandbox implementations, and policy packages should be split out after the first real workflow works.',
          },
        ].map((item, index) => (
          <article
            key={item.title}
            className="island-shell feature-card rise-in rounded-2xl p-5"
            style={{ animationDelay: `${index * 90 + 80}ms` }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="mb-2 text-base font-semibold">
                  {item.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="m-0 text-sm">
                  {item.desc}
                </CardDescription>
              </CardContent>
            </Card>
          </article>
        ))}
      </section>
    </main>
  )
}

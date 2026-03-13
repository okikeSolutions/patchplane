import { createFileRoute } from '@tanstack/react-router'
import { statusLabels, type WorkflowStatus } from '@patchplane/domain'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const timelineStatuses: WorkflowStatus[] = ['queued', 'running', 'reviewed']

export const Route = createFileRoute('/app')({
  component: AppShellPage,
})

function AppShellPage() {
  return (
    <main className="page-wrap px-4 pb-10 pt-14">
      <Card className="island-shell rise-in rounded-4xl py-6 sm:py-8">
        <CardHeader className="gap-3 px-6 sm:px-10">
          <Badge variant="secondary" className="island-kicker">
            Product shell
          </Badge>
          <CardTitle className="display-title text-4xl font-bold tracking-tight sm:text-5xl">
            PatchPlane command center starts here.
          </CardTitle>
          <CardDescription className="max-w-2xl text-base sm:text-lg">
            This route is the shared product surface for both the browser and
            the future desktop shell. PatchPlane keeps it intentionally thin.
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="island-shell rounded-2xl py-6">
          <CardHeader className="gap-2">
            <Badge variant="outline" className="island-kicker">
              Runtime timeline
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Separator />
            <ol className="m-0 flex flex-col gap-4 pl-5">
              {timelineStatuses.map((status) => (
                <li key={status} className="text-sm">
                  <span className="font-semibold">{statusLabels[status]}</span>{' '}
                  is represented in the shared domain package and will be backed
                  by Convex events.
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card className="island-shell rounded-2xl py-6">
          <CardHeader className="gap-2">
            <Badge variant="outline" className="island-kicker">
              Desktop strategy
            </Badge>
          </CardHeader>
          <CardContent>
            <CardDescription className="text-sm">
              The future desktop shell should wrap this UI instead of
              reimplementing it. Native capabilities can arrive later behind a
              bridge boundary.
            </CardDescription>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

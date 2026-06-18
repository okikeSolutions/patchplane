import { BoxesIcon, ClipboardCheckIcon, GitBranchIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const integrations = [
  {
    id: 'repositories',
    title: 'GitHub intake',
    detail: 'Webhook verification and generic external intake are wired.',
    status: 'Ready',
    icon: GitBranchIcon,
  },
  {
    id: 'sandboxes',
    title: 'Daytona sandbox',
    detail: 'Next plugin: provision, checkout, run command, collect logs.',
    status: 'Next',
    icon: BoxesIcon,
  },
  {
    id: 'reviews',
    title: 'Review loop',
    detail: 'Review and decision surfaces land after real sandbox/runtime data.',
    status: 'Planned',
    icon: ClipboardCheckIcon,
  },
] as const

export function IntegrationStatusCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integration status</CardTitle>
        <CardDescription>
          Current repo-to-PatchPlane wiring and upcoming E2E milestones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {integrations.map((integration) => (
            <a
              key={integration.id}
              id={integration.id}
              href={`#${integration.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
              aria-label={integration.title}
            >
              <integration.icon />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{integration.title}</span>
                  <Badge variant="outline">{integration.status}</Badge>
                </span>
                <span className="text-muted-foreground">{integration.detail}</span>
              </span>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

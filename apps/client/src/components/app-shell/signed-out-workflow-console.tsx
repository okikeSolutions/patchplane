import * as m from '@/paraglide/messages'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export function SignedOutWorkflowConsole() {
  return (
    <section className="mx-auto mt-16 flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">{m.app_signed_out_workflows_title()}</h1>
        <p className="m-0 mt-2 text-sm leading-relaxed text-muted-foreground">
          {m.app_signed_out_workflows_intro()}
        </p>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <StatusPreview
          label={m.app_signed_out_queue_label()}
          value={m.app_signed_out_queue_value()}
        />
        <StatusPreview
          label={m.app_signed_out_evidence_label()}
          value={m.app_signed_out_evidence_value()}
        />
        <StatusPreview
          label={m.app_signed_out_decision_label()}
          value={m.app_signed_out_decision_value()}
        />
      </div>
      <Separator className="bg-border/60" />
      <a href="/api/auth/sign-in?returnPathname=/app" className={buttonVariants({ className: 'w-fit' })}>
        {m.app_sign_in()}
      </a>
    </section>
  )
}

function StatusPreview({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <Card size="sm" className="ring-border/60">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 font-medium">{value}</div>
      </CardContent>
    </Card>
  )
}

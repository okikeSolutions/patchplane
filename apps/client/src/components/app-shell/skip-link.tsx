import * as m from '@/paraglide/messages'

export function SkipLink({
  targetId = 'main-content',
}: {
  readonly targetId?: string
}) {
  return (
    <a
      className="fixed top-2 left-2 z-[100] -translate-y-20 rounded-md bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring transition-transform focus:translate-y-0 focus:outline-none motion-reduce:transition-none"
      href={`#${targetId}`}
    >
      {m.app_skip_main()}
    </a>
  )
}

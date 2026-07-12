import { cn } from '@/lib/utils'

interface BrandLogoProps {
  readonly className?: string
  readonly priority?: boolean
}

interface BrandMarkProps {
  readonly className?: string
}

export function BrandLogo({ className, priority = false }: BrandLogoProps) {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <img
        src="/brand/patchplane-wordmark-light.svg"
        alt="patchplane"
        className="h-full w-auto dark:hidden"
        loading={priority ? 'eager' : 'lazy'}
      />
      <img
        src="/brand/patchplane-wordmark-dark.svg"
        alt="patchplane"
        className="hidden h-full w-auto dark:block"
        loading={priority ? 'eager' : 'lazy'}
      />
    </span>
  )
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <img
        src="/brand/patchplane-symbol-light.svg"
        alt=""
        className="size-full dark:hidden"
      />
      <img
        src="/brand/patchplane-symbol-dark.svg"
        alt=""
        className="hidden size-full dark:block"
      />
    </span>
  )
}

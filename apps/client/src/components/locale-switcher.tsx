import * as m from '@/paraglide/messages'
import { getLocale, locales, setLocale } from '@/paraglide/runtime'
import { cn } from '@/lib/utils'
import { buttonVariants } from './ui/button'

export default function LocaleSwitcher() {
  return (
    <div
      className="inline-flex items-center gap-[0.2rem] rounded-full border border-white/[0.08] bg-white/[0.03] p-[0.2rem]"
      role="group"
      aria-label={m.header_locale_switcher()}
    >
      {locales.map((locale) => {
        return (
          <button
            key={locale}
            type="button"
            data-active-locale={locale === getLocale()}
            onClick={() => setLocale(locale)}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'min-w-[2.4rem] rounded-full text-muted-foreground data-[active-locale=true]:bg-white/[0.08] data-[active-locale=true]:text-foreground',
            )}
          >
            {locale === 'en' ? 'EN' : locale === 'de' ? 'DE' : locale}
          </button>
        )
      })}
    </div>
  )
}

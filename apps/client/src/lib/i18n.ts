export const supportedLocales = ['en', 'de'] as const
export type AppLocale = (typeof supportedLocales)[number]

export const localeLabels: Record<AppLocale, string> = {
  en: 'EN',
  de: 'DE',
}

declare module 'shiki/langs/*' {
  import type { LanguageRegistration } from 'shiki'

  const language: LanguageRegistration
  export default language
}

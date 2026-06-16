import { compile } from '@inlang/paraglide-js'
import { translatedPathnames } from '../lib/translated-pathnames'

await compile({
  project: './project.inlang',
  outdir: './src/paraglide',
  emitTsDeclarations: true,
  outputStructure: 'message-modules',
  cookieName: 'PARAGLIDE_LOCALE',
  strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
  urlPatterns: translatedPathnames,
})

import { createBundledHighlighter, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const languageLoaders = {
  bash: () => import('shiki/langs/bash'),
  c: () => import('shiki/langs/c'),
  csharp: () => import('shiki/langs/csharp'),
  css: () => import('shiki/langs/css'),
  dockerfile: () => import('shiki/langs/dockerfile'),
  go: () => import('shiki/langs/go'),
  graphql: () => import('shiki/langs/graphql'),
  html: () => import('shiki/langs/html'),
  ini: () => import('shiki/langs/ini'),
  java: () => import('shiki/langs/java'),
  javascript: () => import('shiki/langs/javascript'),
  json: () => import('shiki/langs/json'),
  jsonc: () => import('shiki/langs/jsonc'),
  kotlin: () => import('shiki/langs/kotlin'),
  lua: () => import('shiki/langs/lua'),
  make: () => import('shiki/langs/make'),
  markdown: () => import('shiki/langs/markdown'),
  mdx: () => import('shiki/langs/mdx'),
  php: () => import('shiki/langs/php'),
  powershell: () => import('shiki/langs/powershell'),
  python: () => import('shiki/langs/python'),
  rust: () => import('shiki/langs/rust'),
  scss: () => import('shiki/langs/scss'),
  shellscript: () => import('shiki/langs/shellscript'),
  sql: () => import('shiki/langs/sql'),
  svelte: () => import('shiki/langs/svelte'),
  swift: () => import('shiki/langs/swift'),
  toml: () => import('shiki/langs/toml'),
  tsx: () => import('shiki/langs/tsx'),
  typescript: () => import('shiki/langs/typescript'),
  vue: () => import('shiki/langs/vue'),
  xml: () => import('shiki/langs/xml'),
  yaml: () => import('shiki/langs/yaml'),
} satisfies Record<string, () => Promise<{ default: { name: string } }>>

const plainTextGrammar = {
  name: 'patchplane-plain-text',
  scopeName: 'text.plain.patchplane',
  patterns: [],
}

const fallbackLoader = (language: string) =>
  () =>
    Promise.resolve({
      default: {
        ...plainTextGrammar,
        name: language,
        scopeName: `text.plain.${language}`,
      },
    })

export const bundledLanguages = new Proxy(languageLoaders, {
  get(target, key, receiver) {
    if (typeof key !== 'string') return Reflect.get(target, key, receiver)
    return Reflect.get(target, key, receiver) ?? fallbackLoader(key)
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key !== 'string') return Reflect.getOwnPropertyDescriptor(target, key)
    return (
      Reflect.getOwnPropertyDescriptor(target, key) ?? {
        configurable: true,
        enumerable: true,
        value: fallbackLoader(key),
        writable: false,
      }
    )
  },
})

export const createHighlighter = createBundledHighlighter({
  engine: () => createJavaScriptRegexEngine(),
  langs: bundledLanguages,
  themes: {},
})

export { createCssVariablesTheme, createJavaScriptRegexEngine }

export function createOnigurumaEngine(): never {
  throw new Error('Patchplane diff highlighting uses the JavaScript regex engine')
}

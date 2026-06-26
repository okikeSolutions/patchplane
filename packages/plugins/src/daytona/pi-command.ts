import { shellQuote } from './daytona-shell'

const piNonInteractiveIsolationFlags = [
  '-p',
  '--no-session',
  '--no-approve',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  '--no-context-files',
] as const

function thinkingFlags(thinking?: string) {
  return thinking === undefined ? [] : ['--thinking', shellQuote(thinking)]
}

export function buildPiCommand(input: {
  readonly provider: string
  readonly model: string
  readonly prompt: string
  readonly version: string
  readonly thinking?: string | undefined
}) {
  return [
    'npx',
    '-y',
    `@earendil-works/pi-coding-agent@${input.version}`,
    ...piNonInteractiveIsolationFlags,
    '--provider',
    shellQuote(input.provider),
    '--model',
    shellQuote(input.model),
    ...thinkingFlags(input.thinking),
    shellQuote(input.prompt),
  ].join(' ')
}

export function buildRedactedPiCommand(input: {
  readonly provider: string
  readonly model: string
  readonly version: string
  readonly thinking?: string | undefined
}) {
  return [
    'npx',
    '-y',
    `@earendil-works/pi-coding-agent@${input.version}`,
    ...piNonInteractiveIsolationFlags,
    '--provider',
    shellQuote(input.provider),
    '--model',
    shellQuote(input.model),
    ...thinkingFlags(input.thinking),
    '<prompt redacted>',
  ].join(' ')
}

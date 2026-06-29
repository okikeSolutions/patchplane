/**
 * Data-only command description for launching Pi inside a remote sandbox.
 *
 * This is intentionally not an Effect CLI `Command` and not an Effect
 * `ChildProcess.Command`: PatchPlane must not run Pi in the trusted control
 * plane. Daytona accepts a remote shell command string, so we keep argv-like
 * structure here until the final sandbox-boundary render step.
 */
export interface PiSandboxCommandSpec {
  readonly command: 'npx'
  readonly args: readonly string[]
}

const piNonInteractiveIsolationArgs = [
  '--mode',
  'json',
  '--no-session',
  '--no-approve',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  '--no-context-files',
] as const

const piRpcIsolationArgs = [
  '--mode',
  'rpc',
  '--no-session',
  '--no-approve',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  '--no-context-files',
] as const

function shellQuote(value: string) {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}

function thinkingArgs(thinking?: string) {
  return thinking === undefined ? [] : ['--thinking', thinking]
}

export function renderShellCommand(spec: PiSandboxCommandSpec) {
  return [spec.command, ...spec.args.map(shellQuote)].join(' ')
}

export function buildPiCommandSpec(input: {
  readonly provider: string
  readonly model: string
  readonly prompt: string
  readonly version: string
  readonly thinking?: string | undefined
}): PiSandboxCommandSpec {
  return {
    command: 'npx',
    args: [
      '-y',
      `@earendil-works/pi-coding-agent@${input.version}`,
      ...piNonInteractiveIsolationArgs,
      '--provider',
      input.provider,
      '--model',
      input.model,
      ...thinkingArgs(input.thinking),
      input.prompt,
    ],
  }
}

export function buildPiRpcCommandSpec(input: {
  readonly provider: string
  readonly model: string
  readonly version: string
  readonly thinking?: string | undefined
}): PiSandboxCommandSpec {
  return {
    command: 'npx',
    args: [
      '-y',
      `@earendil-works/pi-coding-agent@${input.version}`,
      ...piRpcIsolationArgs,
      '--provider',
      input.provider,
      '--model',
      input.model,
      ...thinkingArgs(input.thinking),
    ],
  }
}

export function buildRedactedPiCommandSpec(input: {
  readonly provider: string
  readonly model: string
  readonly version: string
  readonly thinking?: string | undefined
}): PiSandboxCommandSpec {
  return {
    command: 'npx',
    args: [
      '-y',
      `@earendil-works/pi-coding-agent@${input.version}`,
      ...piNonInteractiveIsolationArgs,
      '--provider',
      input.provider,
      '--model',
      input.model,
      ...thinkingArgs(input.thinking),
      '<prompt redacted>',
    ],
  }
}

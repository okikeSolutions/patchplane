function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function buildPiCommand(input: {
  readonly provider: string
  readonly model: string
  readonly prompt: string
  readonly version: string
}) {
  return [
    'npx',
    '-y',
    `@earendil-works/pi-coding-agent@${input.version}`,
    '-p',
    '--no-session',
    '--no-approve',
    '--provider',
    shellQuote(input.provider),
    '--model',
    shellQuote(input.model),
    shellQuote(input.prompt),
  ].join(' ')
}

export function buildRedactedPiCommand(input: {
  readonly provider: string
  readonly model: string
  readonly version: string
}) {
  return [
    'npx',
    '-y',
    `@earendil-works/pi-coding-agent@${input.version}`,
    '-p',
    '--no-session',
    '--no-approve',
    '--provider',
    shellQuote(input.provider),
    '--model',
    shellQuote(input.model),
    '<prompt redacted>',
  ].join(' ')
}

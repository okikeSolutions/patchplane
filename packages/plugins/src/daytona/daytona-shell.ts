const environmentVariableName = /^[A-Za-z_][A-Za-z0-9_]*$/

export function shellQuote(value: string) {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}

export function formatEnvironmentAssignment(key: string, value: string) {
  if (!environmentVariableName.test(key)) {
    throw new Error(`Invalid environment variable name for Daytona command: ${key}`)
  }

  return `${key}=${shellQuote(value)}`
}

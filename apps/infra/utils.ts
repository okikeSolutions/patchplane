function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createPhysicalName(input: {
  readonly id: string
  readonly stage: string
  readonly prefix?: string | undefined
  readonly maxLength?: number | undefined
  readonly delimiter?: string | undefined
  readonly lowercase?: boolean | undefined
  readonly fallback?: string | undefined
}) {
  const delimiter = input.delimiter ?? '-'
  const maxLength = input.maxLength ?? 64
  const lowercase = input.lowercase ?? true
  const fallback = input.fallback ?? 'patchplane'
  const delimiterPattern = escapedRegExp(delimiter)
  const trimDelimiter = new RegExp(`^${delimiterPattern}+|${delimiterPattern}+$`, 'g')
  const repeatedDelimiter = new RegExp(`${delimiterPattern}+`, 'g')
  const invalidCharacters = lowercase ? /[^a-z0-9-]/g : /[^a-zA-Z0-9-]/g
  const base = input.prefix ?? `patchplane${delimiter}${input.stage}${delimiter}${input.id}`
  const sanitized = (lowercase ? base.toLowerCase() : base)
    .replaceAll(invalidCharacters, delimiter)
    .replaceAll(repeatedDelimiter, delimiter)
    .replace(trimDelimiter, '')
  const name = sanitized.length === 0 ? fallback : sanitized

  if (name.length <= maxLength) {
    return name
  }

  return name.slice(0, maxLength).replace(trimDelimiter, '') || fallback.slice(0, maxLength)
}

import { Redacted } from 'effect'

function getStringProperty(value: object, key: string) {
  const property = Reflect.get(value, key)
  return typeof property === 'string' ? property : undefined
}

function getNumberProperty(value: object, key: string) {
  const property = Reflect.get(value, key)
  return typeof property === 'number' ? property : undefined
}

export function redactDaytonaSecret(value: string) {
  return Redacted.make(value)
}

export function sanitizeDaytonaCause(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(cause.stack === undefined ? {} : { stack: cause.stack.split('\n').slice(0, 8).join('\n') }),
    }
  }

  if (typeof cause === 'object' && cause !== null) {
    return {
      name: getStringProperty(cause, 'name'),
      message: getStringProperty(cause, 'message'),
      code: getStringProperty(cause, 'code'),
      status: getNumberProperty(cause, 'status'),
      statusCode: getNumberProperty(cause, 'statusCode'),
      redacted: true,
    }
  }

  return {
    message: String(cause),
  }
}

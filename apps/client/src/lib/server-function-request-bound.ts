import { createMiddleware } from '@tanstack/react-start'

export const maximumServerFunctionBodyBytes = 64 * 1_024

export function hasValidServerFunctionContentLength(value: string | null) {
  if (value === null || value.trim() === '') return false
  const length = Number(value)
  return (
    Number.isSafeInteger(length) &&
    length >= 0 &&
    length <= maximumServerFunctionBodyBytes
  )
}

export const boundedServerFunctionBodyMiddleware = createMiddleware().server(
  (args) => {
    const url = new URL(args.request.url)
    if (
      args.request.method === 'POST' &&
      url.pathname.startsWith('/_serverFn/') &&
      !hasValidServerFunctionContentLength(
        args.request.headers.get('content-length'),
      )
    ) {
      return {
        ...args,
        response: new Response('Server function request body is invalid', {
          status: 413,
        }),
      }
    }
    return args.next()
  },
)

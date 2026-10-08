import { describe, expect, test, vi } from 'vitest'
import { startInstance } from '../start'
import {
  boundedServerFunctionBodyMiddleware,
  hasValidServerFunctionContentLength,
  maximumServerFunctionBodyBytes,
} from './server-function-request-bound'

describe('hasValidServerFunctionContentLength', () => {
  test('accepts bounded byte lengths', () => {
    expect(hasValidServerFunctionContentLength('0')).toBe(true)
    expect(
      hasValidServerFunctionContentLength(
        String(maximumServerFunctionBodyBytes),
      ),
    ).toBe(true)
  })

  test.each([null, '', '-1', '1.5', 'not-a-number'])(
    'rejects an invalid content length %s',
    (value) => {
      expect(hasValidServerFunctionContentLength(value)).toBe(false)
    },
  )

  test('rejects an oversized request', () => {
    expect(
      hasValidServerFunctionContentLength(
        String(maximumServerFunctionBodyBytes + 1),
      ),
    ).toBe(false)
  })
})

describe('bounded server function request middleware', () => {
  test('registers the request bound during TanStack Start initialization', async () => {
    const options = await startInstance.getOptions()

    expect(options.requestMiddleware).toContain(
      boundedServerFunctionBodyMiddleware,
    )
  })

  test('rejects an oversized body before the request continues', async () => {
    const request = new Request('https://app.example/_serverFn/start-workflow', {
      method: 'POST',
      headers: {
        'content-length': String(maximumServerFunctionBodyBytes + 1),
      },
    })
    const next = vi.fn(() => {
      throw new Error('oversized request must not continue')
    })
    const server = boundedServerFunctionBodyMiddleware.options.server
    if (server === undefined) throw new Error('Middleware has no server handler')

    const result = await server({
      request,
      pathname: '/_serverFn/start-workflow',
      context: undefined,
      handlerType: 'serverFn',
      next,
    })

    expect(result).toHaveProperty('response')
    if (!('response' in result)) {
      throw new Error('Oversized server function request was not rejected')
    }
    expect(result.response).toBeInstanceOf(Response)
    expect(result.response.status).toBe(413)
    expect(next).not.toHaveBeenCalled()
  })

  test('continues a bounded server function request', async () => {
    const request = new Request('https://app.example/_serverFn/start-workflow', {
      method: 'POST',
      headers: { 'content-length': '128' },
    })
    const next = vi.fn(() => {
      throw new Error('continue request')
    })
    const server = boundedServerFunctionBodyMiddleware.options.server
    if (server === undefined) throw new Error('Middleware has no server handler')

    expect(() =>
      server({
        request,
        pathname: '/_serverFn/start-workflow',
        context: undefined,
        handlerType: 'serverFn',
        next,
      }),
    ).toThrow('continue request')
    expect(next).toHaveBeenCalledOnce()
  })
})

function bufferBoundedResponse(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body
      ?.cancel('GitHub response exceeded its byte limit')
      .catch(() => undefined)
    return Promise.reject(
      new Error('GitHub response exceeds the configured byte limit'),
    )
  }
  const bodyForbidden = [101, 204, 205, 304].includes(response.status)
  if (bodyForbidden) {
    return Promise.resolve(
      new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    )
  }
  if (response.body === null) return Promise.resolve(response)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const readNext = (): Promise<Response> =>
    reader.read().then((result) => {
      if (!result.done) {
        totalBytes += result.value.byteLength
        if (totalBytes > maxBytes) {
          void reader
            .cancel('GitHub response exceeded its byte limit')
            .catch(() => undefined)
          return Promise.reject(
            new Error('GitHub response exceeds the configured byte limit'),
          )
        }
        chunks.push(result.value)
        return readNext()
      }
      const bytes = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      const boundedResponse = new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
      Object.defineProperty(boundedResponse, 'url', { value: response.url })
      return Promise.resolve(boundedResponse)
    })
  return readNext().finally(() => reader.releaseLock())
}

export function boundedGitHubFetch(maxBytes: number): typeof fetch {
  return (input, init) =>
    globalThis
      .fetch(input, init)
      .then((response) => bufferBoundedResponse(response, maxBytes))
}

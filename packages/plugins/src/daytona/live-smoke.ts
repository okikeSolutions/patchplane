import { NodeCrypto, NodeFileSystem, NodePath } from '@effect/platform-node'
import { Daytona } from '@daytona/sdk'
import { Crypto, Effect, FileSystem, Layer, Path, Redacted } from 'effect'

function parseEnvFile(source: string) {
  const env: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }

    const index = trimmed.indexOf('=')
    if (index < 0) {
      continue
    }

    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function readEnvFile(file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const absolute = path.resolve(process.cwd(), file)

    if (!(yield* fs.exists(absolute))) {
      return {}
    }

    return parseEnvFile(yield* fs.readFileString(absolute))
  })
}

function daytonaConfig(env: Record<string, string | undefined>, apiKey: Redacted.Redacted) {
  return {
    apiKey: Redacted.value(apiKey),
    ...(env.DAYTONA_API_URL === undefined || env.DAYTONA_API_URL.length === 0
      ? {}
      : { apiUrl: env.DAYTONA_API_URL }),
    ...(env.DAYTONA_TARGET === undefined || env.DAYTONA_TARGET.length === 0
      ? {}
      : { target: env.DAYTONA_TARGET }),
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function listByLabels(daytona: Daytona, labels: Record<string, string>) {
  const sandboxes: Array<{ id: string; state: string | undefined }> = []
  for await (const sandbox of daytona.list({ labels })) {
    sandboxes.push({ id: sandbox.id, state: sandbox.state })
  }
  return sandboxes
}

async function waitUntilAbsent(input: {
  readonly daytona: Daytona
  readonly labels: Record<string, string>
  readonly timeoutMs: number
}) {
  const startedAt = Date.now()
  let delayMs = 1_000
  while (Date.now() - startedAt < input.timeoutMs) {
    const survivors = await listByLabels(input.daytona, input.labels)
    if (survivors.length === 0) {
      return []
    }
    await sleep(delayMs)
    delayMs = Math.min(delayMs * 1.5, 5_000)
  }

  return listByLabels(input.daytona, input.labels)
}

const PlatformLayer = Layer.mergeAll(
  NodeCrypto.layer,
  NodeFileSystem.layer,
  NodePath.layer,
)

const program = Effect.gen(function* () {
  const rootEnv = {
    ...yield* readEnvFile('../../.env.local'),
    ...yield* readEnvFile('../../.env'),
    ...process.env,
  }
  const rawApiKey = rootEnv.DAYTONA_API_KEY

  if (rawApiKey === undefined || rawApiKey.length === 0) {
    throw new Error('DAYTONA_API_KEY is required for live Daytona smoke')
  }

  const crypto = yield* Crypto.Crypto
  const apiKey = Redacted.make(rawApiKey)
  const traceId = `daytona-smoke-${yield* crypto.randomUUIDv4}`
  const labels = {
    app: 'patchplane',
    purpose: 'daytona-live-smoke',
    traceId,
  }
  const daytona = new Daytona(daytonaConfig(rootEnv, apiKey))
  let sandbox: Awaited<ReturnType<Daytona['create']>> | undefined
  let deleteAttempted = false
  let deleted = false

  console.log(JSON.stringify({
    event: 'daytona-smoke.start',
    traceId,
    keyRedacted: '<redacted>',
  }))

  try {
    sandbox = yield* Effect.promise(() =>
      daytona.create({
        language: 'typescript',
        ephemeral: true,
        autoStopInterval: 1,
        labels,
      }, { timeout: 120 })
    )

    console.log(JSON.stringify({
      event: 'daytona-smoke.created',
      traceId,
      sandboxId: sandbox.id,
      state: sandbox.state,
      autoDeleteInterval: sandbox.autoDeleteInterval,
    }))

    const response = yield* Effect.promise(() =>
      sandbox!.process.executeCommand(
        'echo patchplane-daytona-live-smoke',
        undefined,
        undefined,
        30,
      )
    )
    const output = response.result ?? response.artifacts?.stdout ?? ''

    console.log(JSON.stringify({
      event: 'daytona-smoke.command',
      traceId,
      sandboxId: sandbox.id,
      exitCode: response.exitCode,
      outputIncludesMarker: output.includes('patchplane-daytona-live-smoke'),
    }))

    if (response.exitCode !== 0 || !output.includes('patchplane-daytona-live-smoke')) {
      throw new Error('Daytona smoke command did not return the expected output')
    }
  } finally {
    const sandboxToDelete = sandbox
    if (sandboxToDelete !== undefined) {
      deleteAttempted = true
      yield* Effect.promise(() => daytona.delete(sandboxToDelete, 120))
      deleted = true
    }
  }

  const survivors = yield* Effect.promise(() =>
    waitUntilAbsent({
      daytona,
      labels,
      timeoutMs: 60_000,
    })
  )
  yield* Effect.promise(() => daytona[Symbol.asyncDispose]?.() ?? Promise.resolve())

  console.log(JSON.stringify({
    event: 'daytona-smoke.complete',
    traceId,
    deleteAttempted,
    deleted,
    survivors,
  }))

  if (survivors.length > 0) {
    process.exitCode = 1
  }
})

await Effect.runPromise(program.pipe(Effect.provide(PlatformLayer)))
